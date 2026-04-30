# CVA Cloud Functions

Firebase Cloud Functions for Gemini-powered annotation generation.

## Overview

This module provides serverless functions that:
1. **Auto-generate annotated charts** when crowdsourcing workers complete tasks
2. **Track generation status** per worker using their Prolific ID
3. **Store generated images** in Firebase Storage with organized paths

## Architecture

### Function: `processTrialAnnotation`
- **Trigger**: Firestore `onCreate` for `trials/{trialDocId}`
- **Purpose**: Generate 2 versions of annotated charts (conservative & creative styles)
- **Worker Identification**: Uses `prolificId` from session data to organize outputs
- **Storage Path**: `reviews/{prolificId}/{trialDocId}_v{1|2}_{timestamp}.png`

### Function: `checkGenerationStatus`
- **Trigger**: HTTP GET request
- **Purpose**: Query generation status for a specific worker's session
- **Endpoint**: `https://{region}-{project-id}.cloudfunctions.net/checkGenerationStatus?prolificId=XXX&sessionId=YYY`

## Setup

### 1. Install Dependencies

```bash
cd functions
npm install
```

### 2. Set Gemini API Key

You need a Gemini API key from Google AI Studio (https://aistudio.google.com).

**Using the modern Secret Manager (recommended):**
```bash
firebase functions:secrets:set GEMINI_API_KEY
# Enter your API key when prompted
```

Verify it's set:
```bash
firebase functions:secrets:access GEMINI_API_KEY
```

### 3. Build TypeScript

```bash
npm run build
```

### 4. Deploy Functions

Deploy all functions:
```bash
firebase deploy --only functions
```

Or deploy specific function:
```bash
firebase deploy --only functions:processTrialAnnotation
```

## Local Development

### Run Functions Emulator

```bash
npm run serve
```

This starts the Firebase emulator for local testing.

### Test Locally

For local testing, you need to set the Gemini API key in `functions/.env`:

```bash
# functions/.env
GEMINI_API_KEY=your_key_here
```

Then update `src/gemini/client.ts` to read from `process.env.GEMINI_API_KEY` when running locally.

## Worker Identification

Each crowdsourcing worker is identified by their **Prolific ID**. This ensures:

- ✅ No confusion between concurrent workers
- ✅ Organized storage paths per worker
- ✅ Easy debugging and audit trails
- ✅ Clean separation of data

### Data Flow

```
1. Worker completes task
   → saves to trials/{prolificId}_{timestamp}_{trialId}

2. Firestore trigger fires
   → extracts prolificId from sessionId
   → logs: "Processing for worker {prolificId}"

3. Gemini generates 2 charts
   → saves to Storage: reviews/{prolificId}/{...}

4. Updates Firestore trial doc
   → generation.status = 'completed'
   → generation.reviewImageUrl1 = public URL
   → generation.reviewImageUrl2 = public URL
   → generation.prolificId = {prolificId}

5. ReviewPage listens in real-time
   → displays loading spinner while processing
   → shows generated images when complete
```

## Monitoring

### View Logs

Real-time logs:
```bash
firebase functions:log
```

Specific function logs:
```bash
firebase functions:log --only processTrialAnnotation
```

### Firebase Console

View function execution, errors, and performance:
https://console.firebase.google.com/project/{your-project}/functions

## File Structure

```
functions/
├── src/
│   ├── index.ts                  # Main function definitions
│   ├── gemini/
│   │   ├── client.ts             # Gemini API wrapper
│   │   └── prompts.ts            # Prompt templates
│   └── utils/
│       └── storage.ts            # Firebase Storage helpers
├── package.json
├── tsconfig.json
└── README.md
```

## Error Handling

If generation fails:
- Status set to `'failed'` in Firestore
- Error message logged to `generation.errorMessage`
- Worker sees error indicator in ReviewPage
- Original chart shown as fallback

## Cost Considerations

- **Gemini API**: Charged per request (2 generations per trial)
- **Firebase Functions**: Charged per invocation + compute time
- **Firebase Storage**: Charged per GB stored + bandwidth

For crowdsourcing studies with many workers, monitor costs in:
- Google Cloud Console → Billing
- Firebase Console → Usage

## Troubleshooting

### "Gemini API key not configured"
```bash
firebase functions:config:set gemini.key="YOUR_KEY"
firebase deploy --only functions
```

### "Failed to fetch image from..."
- Ensure your hosting site is deployed
- Check that `/suneung_images/` are publicly accessible
- Verify the `imageUrl` format in `client.ts`

### Function timeout
- Default timeout is 60s for Firebase Functions
- For slow Gemini responses, increase timeout in `index.ts`:
  ```typescript
  .runWith({ timeoutSeconds: 300 })
  ```

## Next Steps

- [ ] Add retry logic for failed generations
- [ ] Implement batch processing for multiple trials
- [ ] Add image quality validation before storage
- [ ] Monitor and optimize Gemini prompt effectiveness
