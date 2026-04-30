# Implementation Summary: Gemini Integration with Prolific ID Tracking

## Overview

Successfully implemented Gemini-powered annotation generation for the CVA crowdsourcing study platform, with robust worker identification using Prolific IDs.

## What Was Built

### 1. Cloud Functions Architecture

**File Structure:**
```
functions/
├── src/
│   ├── index.ts                 # Main triggers (processTrialAnnotation, checkGenerationStatus)
│   ├── gemini/
│   │   ├── client.ts            # Gemini API wrapper with retry logic
│   │   └── prompts.ts           # Conservative & creative prompt templates
│   └── utils/
│       └── storage.ts           # Firebase Storage upload/delete helpers
├── package.json                 # Dependencies (@google/generative-ai, firebase-functions)
├── tsconfig.json
└── README.md                    # Detailed function documentation
```

**Key Functions:**

1. **`processTrialAnnotation`** (Firestore onCreate trigger)
   - Triggered when: New document in `trials/{trialDocId}`
   - Extracts `prolificId` from `sessionId` (format: `{prolificId}_{timestamp}`)
   - Calls Gemini to generate 2 versions (conservative + creative)
   - Uploads to Storage: `reviews/{prolificId}/{trialDocId}_v{1|2}_{timestamp}.png`
   - Updates Firestore with URLs and status

2. **`checkGenerationStatus`** (HTTP endpoint)
   - GET `/checkGenerationStatus?prolificId=XXX&sessionId=YYY`
   - Returns generation status for all trials in a session
   - Useful for debugging and monitoring

### 2. Client-Side Updates

**ReviewPage.jsx:**
- Added real-time listeners using `onSnapshot()` for each trial
- Tracks generation status per trial: `pending`, `processing`, `completed`, `failed`
- Displays loading spinner while generating
- Shows error fallback if generation fails
- Automatically displays generated images when ready

**New State:**
```javascript
const [generationStatus, setGenerationStatus] = useState({});  // {trialId: 'processing'}
const [generatedImages, setGeneratedImages] = useState({});    // {trialId: {url1, url2}}
```

**ReviewPage.css:**
- `.generation-loading` with animated spinner
- `.generation-error` with warning styling
- Responsive and compact design

### 3. Prolific ID Integration

**Worker Identification Flow:**

1. **Introduction Page** → Extracts `PROLIFIC_PID` from URL query params
2. **Session Init** → `sessionDocId = {prolificId}_{timestamp}`
3. **Trial Submission** → `trialDocId = {sessionDocId}_{trialId}`
4. **Function Trigger** → Extracts `prolificId` from `sessionId`
5. **Storage Organization** → `reviews/{prolificId}/...`
6. **Tracking** → `generation.prolificId` field for audit

**Benefits:**
- ✅ No confusion between concurrent workers
- ✅ Easy data retrieval per worker
- ✅ Clean audit trails in logs
- ✅ Organized storage structure

### 4. Gemini Prompt Strategy

**Two Generation Styles:**

1. **Conservative** (Version 1):
   - Simple, clean annotations
   - Solid colors, basic shapes
   - Minimal text labels
   - Close to user's original drawing

2. **Creative** (Version 2):
   - Expressive annotations
   - Gradients, shadows, glows
   - Varied arrow styles
   - Improved positioning for visual flow

**Prompt Context:**
- Original chart image
- User's rough drawing (base64 PNG)
- Caption text
- User's intent (from survey response)
- Worker ID (for logging)

### 5. Firestore Schema Updates

**Trial Document (`trials/{trialDocId}`):**

```typescript
{
  // ... existing fields ...
  
  generation: {
    status: 'pending' | 'processing' | 'completed' | 'failed',
    startedAt: Timestamp,
    completedAt: Timestamp,
    reviewImageUrl1: string,      // Conservative version
    reviewImageUrl2: string,      // Creative version
    errorMessage?: string,
    prolificId: string,           // Worker tracking
  }
}
```

### 6. Configuration Files

**firebase.json:**
- Added `functions` configuration block
- Set up predeploy build step
- Configured ignored files

**Updated Documentation:**
- `README.md` - Overview with Gemini integration details
- `functions/README.md` - Detailed function documentation
- `DEPLOYMENT.md` - Step-by-step deployment guide
- `IMPLEMENTATION_SUMMARY.md` - This file

## Technical Decisions

### Why Cloud Functions?
- ✅ Keeps API key secure (not exposed to browser)
- ✅ Scales automatically with worker load
- ✅ Firestore triggers enable background processing
- ✅ No user waiting for generation (async)

### Why Two Versions?
- Allows A/B comparison in review stage
- Tests different annotation styles
- Provides fallback if one style fails
- Enables data collection on style preferences

### Why Prolific ID as Primary Identifier?
- Standard for crowdsourcing platforms
- Ensures uniqueness across sessions
- Easy integration with Prolific completion URLs
- Facilitates worker-specific data export

### Why Base64 in Firestore → PNG in Storage?
- Canvas drawings initially stored as base64 (small, ~50KB)
- Generated images are larger (~200KB)
- Storage is cheaper than Firestore for large binary data
- Public URLs easier to serve than base64

## Deployment Steps (Summary)

1. **Set Gemini API Key:**
   ```bash
   firebase functions:config:set gemini.key="YOUR_KEY"
   ```

2. **Install Dependencies:**
   ```bash
   cd functions && npm install && cd ..
   ```

3. **Build:**
   ```bash
   npm run build
   cd functions && npm run build && cd ..
   ```

4. **Deploy:**
   ```bash
   firebase deploy
   # Or: firebase deploy --only functions,hosting
   ```

5. **Verify:**
   - Complete a test task
   - Check function logs: `firebase functions:log --tail`
   - Verify Firestore trial has `generation.status: 'completed'`
   - Check Storage for generated images

## Testing Checklist

- [ ] Test task submission triggers function
- [ ] Verify Gemini API call succeeds
- [ ] Check Storage upload works
- [ ] Confirm Firestore update with URLs
- [ ] Test ReviewPage displays images
- [ ] Verify loading states show correctly
- [ ] Test error handling (invalid API key)
- [ ] Check concurrent workers don't interfere
- [ ] Monitor costs after pilot run
- [ ] Export data with worker IDs

## Performance Characteristics

**Expected Timing:**
- Task submission → Function trigger: ~500ms
- Gemini generation (2 images): ~10-30s
- Storage upload: ~2-5s
- Total: 15-40s per trial

**Cost Estimates (per worker, 5 trials):**
- Gemini API: 10 calls × $0.XX = $X.XX
- Cloud Functions: 10 invocations × $0.XX = $X.XX
- Storage: 10 images × 200KB = 2MB (~$0.00)
- Firestore: Reads/writes (~$0.00)
- **Total per worker: ~$X.XX** (depends on Gemini pricing tier)

## Known Limitations & Future Work

### Current Limitations:
1. No retry logic for failed generations (worker sees error)
2. Function timeout fixed at 60s (may fail for slow Gemini responses)
3. No image quality validation before storage
4. No prompt optimization based on chart type

### Planned Enhancements:
1. **Retry Logic**: Automatic retry with exponential backoff
2. **Batch Processing**: Generate all trials for a worker at once
3. **Quality Checks**: Validate generated images before storage
4. **Adaptive Prompts**: Customize prompts based on chart type
5. **Cost Monitoring**: Real-time cost alerts in admin dashboard
6. **A/B Testing**: Track which generation style users prefer

## Files Created/Modified

### New Files:
- `functions/src/index.ts`
- `functions/src/gemini/client.ts`
- `functions/src/gemini/prompts.ts`
- `functions/src/utils/storage.ts`
- `functions/package.json`
- `functions/tsconfig.json`
- `functions/.gitignore`
- `functions/README.md`
- `DEPLOYMENT.md`
- `IMPLEMENTATION_SUMMARY.md`

### Modified Files:
- `src/components/Review/ReviewPage.jsx` - Added real-time listeners
- `src/components/Review/ReviewPage.css` - Added loading/error styles
- `firebase.json` - Added functions configuration
- `README.md` - Updated with Gemini integration details

## Success Metrics

The implementation is considered successful if:
- ✅ Functions deploy without errors
- ✅ 95%+ generation success rate
- ✅ Average generation time < 30s
- ✅ Zero worker ID collisions
- ✅ Cost per worker < budget threshold
- ✅ ReviewPage loads generated images smoothly
- ✅ Logs show clear worker identification

## Support & Maintenance

**Monitoring:**
- Function logs: `firebase functions:log`
- Firebase Console → Functions dashboard
- Firestore query: `generation.status == 'failed'`

**Debugging:**
- Check function logs for error messages
- Verify Gemini API key: `firebase functions:config:get`
- Test Gemini API directly with curl
- Inspect Storage bucket for missing images

**Updates:**
- Gemini prompts: Edit `functions/src/gemini/prompts.ts` → redeploy
- Function logic: Edit `functions/src/index.ts` → redeploy
- Timeout/memory: Add `.runWith()` in function definition

## Conclusion

The Gemini integration is fully implemented with robust worker tracking using Prolific IDs. The system is ready for pilot testing with crowdsourcing workers. Key features include:

- Automated background generation after each task
- Real-time status updates in ReviewPage
- Clean data organization per worker
- Comprehensive error handling and logging
- Detailed documentation for maintenance

Next step: Deploy to production and run pilot with 5-10 test workers to validate end-to-end flow and cost estimates.
