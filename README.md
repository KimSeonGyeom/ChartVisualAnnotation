# Chart Visual Annotation (CVA) Study

A crowdsourcing study platform for visual chart annotation with AI-enhanced review capabilities.

## Overview

This application allows participants to:
1. Annotate charts with visual highlights using pen tools
2. Answer survey questions about their annotations
3. Review AI-generated cleaned-up versions of their annotations
4. Provide feedback on the quality and accuracy of the generated versions

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
│   ├── Introduction/    # Consent and intro page
│   ├── Tutorial/        # Practice trials
│   ├── Task/           # Main annotation tasks
│   ├── Review/         # Review AI-generated versions
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
```

## Key Flow

1. **Introduction** → Consent & Prolific ID
2. **Tutorial** → Practice with pen tools
3. **Task** → Annotate charts (N trials)
4. **Review** → After last trial, review generated version
5. **Finish** → Complete & redirect to Prolific

## Review Stage

After completing all annotation tasks, participants enter the review stage where:

- They see a "cleaned-up" version of their last annotation
- Currently uses the original chart as placeholder (`reviewImageUrl` falls back to `imageUrl`)
- **Future**: Replace with AI-generated image by adding `reviewImageUrl` to stimulus data
- Participants can draw feedback marks on the reviewed version
- Survey questions assess intent reflection and visual quality

### Adding AI-Generated Images

To integrate AI-generated images (e.g., from Gemini):

1. Generate cleaned-up annotation image
2. Store in Firebase Storage or public folder
3. Add `reviewImageUrl` field to stimulus in Firestore or JSON:

```json
{
  "id": "trial_1",
  "imageUrl": "/images/chart_1.png",
  "reviewImageUrl": "/generated/chart_1_clean.png",
  "caption": "..."
}
```

4. ReviewPage will automatically use `reviewImageUrl` if available

## Firebase Collections

- **sessions**: Participant sessions with metadata
- **trials**: Individual annotation trials with drawings & responses
- **reviews**: Review stage data with feedback annotations
- **sets**: Study set configurations (auto-assigned)

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

```bash
npm install
npm run dev
```

## Deployment

```bash
npm run build
firebase deploy
```

## Tech Stack

- React + Vite
- Fabric.js (canvas drawing)
- Firebase (Hosting, Firestore, Storage)
- React Router
- Zustand (state management)
