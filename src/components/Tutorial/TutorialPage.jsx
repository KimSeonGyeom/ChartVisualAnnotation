import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ChartCanvas from '../Task/ChartCanvas';
import PenToolbar, { DrawingToolInstructions } from '../Task/PenToolbar';
import studyConfig from '../../config/study.json';
import { useDrawingStore } from '../../stores/useDrawingStore';
import { useStudyStore, getChartAssetFolder } from '../../stores/useStudyStore';
import '../Task/TaskPage.css';
import './TutorialPage.css';

const TUTORIAL_CAPTION =
  'The percentage of people in the 18-29 group who said they had read a print book was 74%, which was the highest among the four groups.';

const chartFolder = getChartAssetFolder();
/** Practice canvas uses the dedicated tutorial chart asset (not a numbered task chart). */
const PRACTICE_CHART_URL = `/${chartFolder}/tutorial_example.png`;

const TUTORIAL_TRIAL_ID = 'tutorial_practice';

/** Match right-column example image max width so both columns align; height follows chart aspect ratio (no letterboxing). */
const PRACTICE_DISPLAY_MAX_W = 520;

export default function TutorialPage() {
  const navigate = useNavigate();
  const canvasActionsRef = useRef(null);
  const [practiceCanvasSize, setPracticeCanvasSize] = useState(() => ({
    width: PRACTICE_DISPLAY_MAX_W,
    height: Math.round(PRACTICE_DISPLAY_MAX_W * 0.75),
  }));
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const { initializeFromConfig, startNewTrial, getStats, getActivities } = useDrawingStore();

  useEffect(() => {
    initializeFromConfig(studyConfig);
    startNewTrial();
  }, [initializeFromConfig, startNewTrial]);

  useEffect(() => {
    const { trialTimings, startTrial } = useStudyStore.getState();
    if (trialTimings.some((t) => t.trialId === TUTORIAL_TRIAL_ID)) return;
    startTrial(TUTORIAL_TRIAL_ID);
  }, []);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      if (!nw || !nh) return;
      const w = PRACTICE_DISPLAY_MAX_W;
      const h = Math.round((nh / nw) * w);
      setPracticeCanvasSize({ width: w, height: h });
    };
    img.src = PRACTICE_CHART_URL;
  }, []);

  const handleCanvasReady = (actions) => {
    canvasActionsRef.current = actions;
  };

  const handleStartTask = async () => {
    setSaveError('');
    const { sessionDocId, completeTrial } = useStudyStore.getState();

    if (!sessionDocId) {
      navigate('/task');
      return;
    }

    setIsSaving(true);
    try {
      completeTrial(TUTORIAL_TRIAL_ID);
      
      // Save tutorial image to Storage only (not Firestore)
      const canvasData = canvasActionsRef.current?.export();
      if (canvasData?.imageData) {
        const storageRef = ref(storage, `tutorials/${sessionDocId}_tutorial.jpg`);
        await uploadString(storageRef, canvasData.imageData, 'data_url');
        console.log('Tutorial image saved to Storage');
      }
      
      navigate('/task');
    } catch (err) {
      console.error('Failed to save tutorial practice:', err);
      setSaveError('Could not save your practice drawing. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="tutorial-page">
      <div className="tutorial-container">
        <h1 className="tutorial-title">Tutorial and Practice</h1>
        <div className="tutorial-visual-emphasis">
          <div className="tutorial-images-section">
            <h2 className="tutorial-section-label">Drawing Tool Instructions</h2>
            <DrawingToolInstructions />

            <h2 className="tutorial-section-label" style={{marginTop: '1.5rem'}}>Practice Canvas</h2>
            <div className="tutorial-comparison">
              <div className="tutorial-comparison-toolbar">
                <div className="canvas-wrapper tutorial-practice-canvas-wrap">
                  <PenToolbar
                    onUndo={() => canvasActionsRef.current?.undo()}
                    onRedo={() => canvasActionsRef.current?.redo()}
                    onClear={() => canvasActionsRef.current?.clear()}
                  />
                </div>
              </div>
              <div className="tutorial-comparison-spacer" aria-hidden="true" />
              <div className="tutorial-comparison-canvas">
                <ChartCanvas
                  key="tutorial-practice-canvas"
                  imageUrl={PRACTICE_CHART_URL}
                  width={practiceCanvasSize.width}
                  height={practiceCanvasSize.height}
                  onCanvasReady={handleCanvasReady}
                />
                <p className="tutorial-image-label">
                  <strong>Left: practice canvas (same tool as in the task).</strong>
                </p>
              </div>
              <div className="tutorial-comparison-sample">
                <img src={`/${chartFolder}/tutorial_example.png`} alt="Chart with example visual highlights" />
                <p className="tutorial-image-label">
                  <strong>Right: example highlights based on the caption.</strong>
                </p>
              </div>
            </div>
          </div>
          <div className="tutorial-caption-panel">
            <h2 className="tutorial-section-label">Caption</h2>
            <p className="caption-paragraph">
              <span className="caption-sentence caption-sentence--highlight">{TUTORIAL_CAPTION}</span>
            </p>
          </div>
        </div>

        <p className="tutorial-desc">
          Your goal is to draw <strong>visual highlights</strong> on the <strong>chart</strong> to help others understand the caption in a clear way.
          <br />
          The goal can usually be described as: "[Description of your drawing] helps others to [Impact of your drawing]."
          <br />
          For example, "A combination of a horizontal line, number, and downward arrows makes it noticeable and easier to understand how much the other groups are lower than the 18-29 group."
        </p>

        <p className="tutorial-desc">
          Please refer to the <strong>Drawing Tool Instructions</strong> above to understand how to use the tools to draw visual highlights.
          <strong>TODO:</strong> To show that you have understood how to use the tools to draw visual highlights, draw the visual highlights on the left chart in the same way as the example on the right.
        </p>

        {saveError && <p className="error-message tutorial-save-error">{saveError}</p>}

        <button
          type="button"
          className="btn btn-primary btn-large tutorial-btn"
          onClick={handleStartTask}
          disabled={isSaving}
        >
          {isSaving ? 'Saving…' : 'Start Task'}
        </button>
      </div>
    </div>
  );
}
