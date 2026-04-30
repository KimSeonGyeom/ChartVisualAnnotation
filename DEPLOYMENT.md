# Deployment Guide - CVA with Gemini Integration

This guide walks through deploying the Chart Visual Annotation platform with Gemini-powered annotation generation.

## Prerequisites

- [ ] Firebase CLI installed (`npm install -g firebase-tools`)
- [ ] Firebase project created
- [ ] Gemini API key from [Google AI Studio](https://aistudio.google.com)
- [ ] Node.js 18+ installed

## Step-by-Step Deployment

### 1. Firebase Project Setup

```bash
# Login to Firebase
firebase login

# Initialize project (if not already done)
firebase init

# Select:
# - Firestore
# - Functions (Node.js, TypeScript)
# - Hosting
# - Storage

# Set active project
firebase use chartvisannotation
```

### 2. Configure Environment Variables

**Frontend (.env):**
```bash
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=chartvisannotation.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=chartvisannotation
VITE_FIREBASE_STORAGE_BUCKET=chartvisannotation.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

**Functions (Gemini API Key):**
```bash
# Modern method using Secret Manager
firebase functions:secrets:set GEMINI_API_KEY
# Enter your API key when prompted

# Verify
firebase functions:secrets:access GEMINI_API_KEY
```

### 3. Install Dependencies

**Frontend:**
```bash
npm install
```

**Functions:**
```bash
cd functions
npm install
cd ..
```

### 4. Upload Chart Images

Ensure all chart images are in `public/suneung_images/`:
```
public/
└── suneung_images/
    ├── suneung1.png
    ├── suneung2.png
    ├── ...
    └── suneung50.png
```

### 5. Initialize Firestore Data

**Option A: Firebase Console**

1. Go to Firestore → Add collection → `sets`
2. Add documents for each set:

```json
// Document ID: suneung_set_0
{
  "type": "suneung",
  "captionIndex": 0,
  "indices": [1, 5, 9, 13, 17]
}

// Document ID: suneung_set_1
{
  "type": "suneung",
  "captionIndex": 1,
  "indices": [2, 6, 10, 14, 18]
}

// ... suneung_set_2, suneung_set_3
```

3. Add initial counter:
```json
// Collection: config
// Document ID: assignment_counter
{
  "count": 0
}
```

**Option B: Import Script (if you have backup)**

```bash
node scripts/importFirestore.js path/to/serviceAccountKey.json path/to/backup
```

### 6. Deploy Security Rules

**Firestore Rules (firestore.rules):**
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow reads for authenticated sessions
    match /sessions/{sessionId} {
      allow read, write: if true;  // Adjust for production
    }
    match /trials/{trialId} {
      allow read, write: if true;
    }
    match /reviews/{reviewId} {
      allow read, write: if true;
    }
    match /sets/{setId} {
      allow read: if true;
      allow write: if false;  // Only admins/functions can write
    }
    match /config/{doc} {
      allow read: if true;
      allow write: if false;
    }
  }
}
```

**Storage Rules (storage.rules):**
```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // Public read for generated review images
    match /reviews/{prolificId}/{imageFile} {
      allow read: if true;
      allow write: if false;  // Only Cloud Functions can write
    }
  }
}
```

Deploy rules:
```bash
firebase deploy --only firestore:rules,storage:rules
```

### 7. Build and Deploy

**Full deployment:**
```bash
# Build frontend
npm run build

# Build functions
cd functions
npm run build
cd ..

# Deploy everything
firebase deploy
```

**Incremental deployment:**
```bash
# Deploy only hosting
firebase deploy --only hosting

# Deploy only functions
firebase deploy --only functions

# Deploy specific function
firebase deploy --only functions:processTrialAnnotation
```

### 8. Verify Deployment

#### Check Hosting
```bash
# Your site should be live at:
https://chartvisannotation.web.app
```

#### Test Function Triggers

1. Complete a task as a test participant
2. Check Cloud Function logs:
```bash
firebase functions:log --tail
```

3. Look for:
```
🔄 Starting generation for trial {trialDocId} (worker: {prolificId})
📊 Processing chart {chartIndex} for worker {prolificId}
✅ Generated annotations for trial {trialDocId} (worker: {prolificId})
```

4. Verify in Firestore:
   - Open trial document
   - Check `generation.status` = `'completed'`
   - Check `generation.reviewImageUrl1` and `reviewImageUrl2` have URLs

5. Verify in Storage:
   - Navigate to `reviews/{prolificId}/`
   - Should see generated PNG files

## Post-Deployment Checks

### 1. Test End-to-End Flow

1. Visit site with Prolific URL parameters:
   ```
   https://chartvisannotation.web.app?PROLIFIC_PID=test123
   ```

2. Complete introduction → tutorial → task
3. After task submission, check:
   - Firestore `trials` document has `generation.status: 'processing'`
   - Function logs show processing
   - Status updates to `'completed'`
   - ReviewPage shows generated images

### 2. Monitor Costs

**Gemini API:**
- [Google AI Studio Dashboard](https://aistudio.google.com)
- Set usage alerts

**Firebase:**
- [Firebase Console → Usage](https://console.firebase.google.com)
- Monitor Functions invocations
- Monitor Storage usage
- Monitor Firestore reads/writes

### 3. Set Budget Alerts

```bash
# Google Cloud Console → Billing → Budgets & alerts
# Set alerts at:
# - 50% of budget
# - 90% of budget
# - 100% of budget
```

## Rollback Procedure

If deployment fails or causes issues:

```bash
# Rollback to previous hosting deployment
firebase hosting:channel:deploy rollback

# Rollback specific function
firebase functions:delete processTrialAnnotation
# Then redeploy previous version

# Restore Firestore data from backup
node scripts/importFirestore.js path/to/serviceAccountKey.json path/to/backup
```

## Production Optimizations

### 1. Enable CORS for Cloud Functions

If calling functions from external domains:

```typescript
// In functions/src/index.ts
res.set('Access-Control-Allow-Origin', 'https://your-domain.com');
```

### 2. Increase Function Timeout

For slow Gemini responses:

```typescript
export const processTrialAnnotation = functions
  .runWith({ timeoutSeconds: 300, memory: '1GB' })
  .firestore
  .document('trials/{trialDocId}')
  .onCreate(async (snapshot, context) => {
    // ...
  });
```

### 3. Add Retry Logic

```typescript
// In functions/src/gemini/client.ts
const MAX_RETRIES = 3;

async function generateWithRetry(model, prompt, input, retries = 0) {
  try {
    return await generateSingleChart(model, prompt, input);
  } catch (error) {
    if (retries < MAX_RETRIES) {
      console.log(`Retry ${retries + 1}/${MAX_RETRIES}...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return generateWithRetry(model, prompt, input, retries + 1);
    }
    throw error;
  }
}
```

### 4. Optimize Image Storage

Set lifecycle rules to delete old images:

```bash
# In Google Cloud Console → Storage → Lifecycle
# Add rule:
# - Delete objects older than 90 days
# - Match prefix: reviews/
```

## Monitoring Dashboard

Create custom dashboard for study monitoring:

1. **Firebase Console → Functions → Dashboard**
   - Invocations per day
   - Error rate
   - Execution time

2. **Firestore Console → Data**
   - Query: `generation.status == 'failed'` to see failures
   - Query: `generation.status == 'completed'` to track progress

3. **Storage Console → Browser**
   - Check size of `reviews/` folder
   - Verify images are being created

## Troubleshooting

### Function not triggering

```bash
# Check function deployment
firebase functions:list

# Check logs for errors
firebase functions:log --only processTrialAnnotation

# Verify Firestore trigger path
# Path should match: trials/{trialDocId}
```

### Gemini API errors

```bash
# Verify API key
firebase functions:config:get

# Check quota/billing at Google AI Studio

# Test API key manually:
curl -X POST "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Hello"}]}]}'
```

### Storage permission errors

```bash
# Check Storage rules
firebase deploy --only storage:rules

# Verify bucket name in functions/src/index.ts
const storage = admin.storage();
const bucket = storage.bucket();  // Uses default bucket

# If using custom bucket:
const bucket = storage.bucket('gs://your-bucket.appspot.com');
```

## Support

- Functions docs: `functions/README.md`
- Main README: `README.md`
- Firebase docs: https://firebase.google.com/docs
- Gemini docs: https://ai.google.dev/docs

## Next Steps After Deployment

1. **Pilot Test**: Run 5-10 test participants
2. **Monitor Costs**: Check billing after pilot
3. **Adjust Prompts**: Refine Gemini prompts based on output quality
4. **Scale Up**: Open to full crowdsourcing pool
5. **Export Data**: Use `scripts/dumpFirestore.js` regularly for backups
