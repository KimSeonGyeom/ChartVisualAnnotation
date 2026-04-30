import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ChartCanvas from '../Task/ChartCanvas';
import PenToolbar from '../Task/PenToolbar';
import { useDrawingStore } from '../../stores/useDrawingStore';
import { useStudyStore } from '../../stores/useStudyStore';
import { ref, uploadString } from 'firebase/storage';
import { storage } from '../../services/firebase';
import studyConfig from '../../config/study.json';
import '../Task/TaskPage.css';
import './TutorialPage.css';

const TUTORIAL_CAPTION =
  'The percentage of people in the 18-29 group who said they had read a print book was 74%, which was the highest among the four groups.';

const PRACTICE_CHART_URL = '/suneung_images/suneung0.png';

/** Tutorial uses a dedicated image that won't appear in actual tasks */
const TUTORIAL_TRIAL_ID = 'tutorial_practice';
const TUTORIAL_IMAGE_INDEX = 0; // Index 0 reserved for tutorial, not used in task sets

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
            <div className="canvas-instruction">
              <ul className="canvas-instruction-list">
                <li>
                  <strong>Pen:</strong> select Pen in the toolbar, then draw on the chart.
                </li>
                <li>
                  <strong>Eraser:</strong> select Eraser and drag over pen strokes you drew; overlapping strokes are removed.
                </li>
                <li>
                  <strong>Color:</strong> change the pen color from the Color menu at the top right of the toolbar.
                </li>
                <li>
                  <strong>Undo / Clear:</strong> use the buttons at the top left to undo or redo. Click the X to clear all drawings.
                </li>
                <li>
                  To make <strong>straight lines</strong>, hold the <strong>Shift</strong> key while drawing with the pen.
                </li>
              </ul>
            </div>

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
                <img src="/suneung_images/tutorial_example.png" alt="Chart with example visual highlights" />
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
          In this task, you will be given <strong>three pairs of a chart image and a caption sentence</strong>.
          <br />
          Your goal is to draw <strong>visual highlights</strong> on the original <strong>chart image</strong> to help others understand the caption in a clear, friendly way.
        </p>

        <p className="tutorial-desc">
          The <strong>original chart image</strong> is shown on the left. You can use the <strong>Pen</strong> and{' '}
          <strong>Eraser</strong> tools to draw <strong>visual highlights</strong>.
          <br />
          To show that you have understood this tutorial, please draw visual highlights on the{' '}
          <strong>left</strong> in a similar way to the example on the <strong>right</strong>.
        </p>

        <p className="tutorial-desc">
          For the tasks in following stages, you will be given a new chart image and a new caption sentence.
          <br />
          There are no right or wrong answers.
          <br />
          <strong>Feel free to draw any visual highlights on any parts of the chart if you think it helps others understand the caption!</strong>
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
