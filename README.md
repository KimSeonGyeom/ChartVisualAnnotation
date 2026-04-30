# Chart Visual Annotation (CVA) Study

A crowdsourcing study platform for visual chart annotation with AI-enhanced review capabilities.

## Overview

This application allows participants to:
1. Annotate charts with visual highlights using pen tools
2. Answer survey questions about their annotations
3. Review AI-generated cleaned-up versions of their annotations (powered by Gemini)
4. Provide feedback on the quality and accuracy of the generated versions

**Worker Identification**: Each crowdsourcing worker is uniquely identified by their **Prolific ID** to ensure clean data separation and prevent confusion between concurrent participants.

## Features

- **Visual Annotation**: Fabric.js-based canvas for drawing on charts
- **Survey System**: Configurable questions with multiple question types (Likert, text, single-choice)
- **Review Stage**: Participants can review generated versions and mark specific areas for feedback
- **Firebase Integration**: Data storage in Firestore with real-time updates
- **Set Assignment**: Automatic participant assignment to study sets

## Project Structure

```
src/
├── components/
│   ├── Introduction/    # Consent and intro page (collects Prolific ID)
│   ├── Tutorial/        # Practice trials
│   ├── Task/           # Main annotation tasks
│   ├── Review/         # Review AI-generated versions (real-time updates)
│   ├── Finish/         # Completion page
│   └── Admin/          # Admin dashboard
├── config/
│   ├── questions.json  # Survey questions (task + review)
│   ├── study.json      # Study configuration
│   └── stimuli.json    # Chart stimuli data
├── stores/
│   ├── useStudyStore.js    # Study state & Firebase
│   └── useDrawingStore.js  # Drawing activity tracking
└── services/
    └── firebase.js     # Firebase configuration

functions/
├── src/
│   ├── index.ts                 # Cloud Function definitions
│   ├── gemini/
│   │   ├── client.ts            # Gemini API wrapper
│   │   └── prompts.ts           # Prompt templates
│   └── utils/
│       └── storage.ts           # Firebase Storage helpers
├── package.json
└── tsconfig.json
```

## Key Flow

1. **Introduction** → Consent & Prolific ID
2. **Tutorial** → Practice with pen tools
3. **Task** → Annotate charts (N trials)
4. **Review** → After last trial, review generated version
5. **Finish** → Complete & redirect to Prolific

## Review Stage & Gemini Integration

After completing all annotation tasks, participants enter the review stage where:

- They see **2 AI-generated versions** of their annotations (one conservative, one creative)
- **Background Processing**: Cloud Functions automatically generate these after each task submission
- **Real-time Updates**: ReviewPage listens to Firestore and displays loading spinners while generating
- Survey questions assess which version is better, intent reflection, and visual quality

### How AI Generation Works

1. **Task Submission**: When a worker completes a trial, data is saved to `trials/{prolificId}_{timestamp}_{trialId}`
2. **Firestore Trigger**: Cloud Function `processTrialAnnotation` fires automatically
3. **Gemini API Call**: Function sends original chart + user drawing to Gemini for 2 versions
4. **Storage Upload**: Generated images saved to `reviews/{prolificId}/{trialDocId}_v{1|2}.png`
5. **Firestore Update**: Trial document updated with `generation.reviewImageUrl1/2`
6. **Real-time Display**: ReviewPage receives update and shows generated images

### Worker Identification

Each worker's data is organized by their **Prolific ID**:
- Trial documents: `{prolificId}_{timestamp}_{trialId}`
- Storage paths: `reviews/{prolificId}/...`
- Generation logs: Tagged with `prolificId` for debugging

This ensures:
- ✅ No confusion between concurrent workers
- ✅ Easy data retrieval per worker
- ✅ Clean audit trails

## Firebase Collections

- **sessions**: Participant sessions with metadata (includes `prolificId`)
- **trials**: Individual annotation trials with drawings & responses
  - Document ID format: `{prolificId}_{timestamp}_{trialId}`
  - Includes `generation` object tracking AI generation status
- **reviews**: Review stage data with feedback annotations
- **sets**: Study set configurations (auto-assigned)
- **config**: Global counters (e.g., `assignment_counter` for set rotation)

### Trial Document Structure

```typescript
{
  sessionId: string,           // "{prolificId}_{timestamp}"
  trialId: string,             // "trial_1", "trial_2", ...
  imageIndex: number,          // Chart index in dataset
  annotation: {
    svg: string,               // SVG representation
    imageData: string,         // Base64 PNG
  },
  responses: {
    drawing_help_intent: string,
    // ... other survey responses
  },
  generation: {
    status: 'pending' | 'processing' | 'completed' | 'failed',
    startedAt: Timestamp,
    completedAt: Timestamp,
    reviewImageUrl1: string,   // Generated version 1 (conservative)
    reviewImageUrl2: string,   // Generated version 2 (creative)
    errorMessage?: string,
    prolificId: string,        // Worker ID for tracking
  },
  submittedAt: Timestamp,
}
```

## Configuration

### Study Settings (`study.json`)

```json
{
  "title": "Chart Visual Annotation Study",
  "prolificCompletionUrl": "https://app.prolific.com/...",
  "estimatedMinutes": 15,
  "features": {
    "allowPenCustomization": true,
    "penDefaults": { "color": "#000000", "width": 2 }
  }
}
```

### Questions (`questions.json`)

- `versions[0]`: Task questions
- `review`: Review-specific questions

## Development

### Frontend

```bash
npm install
npm run dev
```

### Cloud Functions (Local)

```bash
cd functions
npm install
npm run build
npm run serve  # Start Firebase emulator
```

## Deployment

### Full Deployment (Frontend + Functions)

1. **Set Gemini API Key** (one-time setup):
```bash
# Using modern Secret Manager
firebase functions:secrets:set GEMINI_API_KEY
# Enter your API key when prompted
```

2. **Build and Deploy**:
```bash
# Build frontend
npm run build

# Build and deploy functions
cd functions
npm run build
cd ..

# Deploy everything
firebase deploy
```

### Deploy Specific Components

```bash
# Frontend only
firebase deploy --only hosting

# Functions only
firebase deploy --only functions

# Firestore rules only
firebase deploy --only firestore:rules

# Storage rules only
firebase deploy --only storage
```

### First-Time Setup Checklist

- [ ] Create Firebase project
- [ ] Enable Firestore, Storage, Hosting, Functions
- [ ] Get Gemini API key from [Google AI Studio](https://aistudio.google.com)
- [ ] Set API key: `firebase functions:config:set gemini.key="..."`
- [ ] Update `.env` with Firebase config
- [ ] Deploy Firestore security rules
- [ ] Deploy Storage security rules
- [ ] Upload chart images to `public/suneung_images/`
- [ ] Upload dataset JSONs (`suneung_caption.json`)
- [ ] Initialize set documents in Firestore (see below)
- [ ] Deploy hosting and functions

### Initialize Firestore Sets

Run this once to populate the `sets` collection:

```javascript
// In Firebase Console → Firestore → Run query
const sets = [
  {
    id: 'suneung_set_0',
    type: 'suneung',
    captionIndex: 0,
    indices: [1, 5, 9, 13],  // Adjust to your chart IDs
  },
  // ... add suneung_set_1, 2, 3
];

sets.forEach(set => {
  db.collection('sets').doc(set.id).set(set);
});
```

## Tech Stack

### Frontend
- React + Vite
- Fabric.js (canvas drawing)
- React Router (navigation)
- Zustand (state management)
- Firebase SDK (Firestore, Storage, Auth)

### Backend
- Firebase Hosting (static site)
- Firebase Cloud Functions (Node.js 18, TypeScript)
- Firebase Firestore (NoSQL database)
- Firebase Storage (image storage)

### AI/ML
- Google Gemini 1.5 Pro (multimodal image generation)

## Monitoring & Debugging

### View Function Logs

```bash
# Real-time logs
firebase functions:log

# Specific function
firebase functions:log --only processTrialAnnotation

# Follow logs
firebase functions:log --tail
```

### Check Generation Status

For a specific worker's session:
```bash
curl "https://{region}-{project-id}.cloudfunctions.net/checkGenerationStatus?prolificId=XXX&sessionId=YYY"
```

### Firebase Console

- **Functions Dashboard**: Monitor invocations, errors, execution time
- **Firestore**: View trial documents and generation status
- **Storage**: Browse generated images organized by `prolificId`

## Cost Optimization

For crowdsourcing studies with many workers:

1. **Gemini API**: 
   - 2 calls per trial × N trials per worker × M workers
   - Monitor usage at Google AI Studio
   
2. **Cloud Functions**:
   - Optimize by running only on main trials (skip tutorial)
   - Consider batching multiple trials per worker

3. **Storage**:
   - Images are ~200KB each
   - Set lifecycle rules to delete after study completion

4. **Firestore**:
   - Reads: Review page listens to trial documents (real-time)
   - Writes: 1 per trial generation
   - Consider monthly budget alerts

## Troubleshooting

### "No prolificId found"
- Ensure URL includes `?PROLIFIC_PID=...` parameter
- Check IntroductionPage is extracting from `searchParams`

### "Generation failed"
- Check Cloud Function logs for errors
- Verify Gemini API key is set correctly
- Ensure original chart images are publicly accessible
- Check function timeout (default 60s, may need increase)

### "Images not loading in ReviewPage"
- Verify Storage rules allow public read
- Check `reviewImageUrl1/2` are valid public URLs
- Inspect Network tab in browser DevTools

## Contributing

See `functions/README.md` for detailed Cloud Functions documentation.
