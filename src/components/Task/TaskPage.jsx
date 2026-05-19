import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStudyStore } from '../../stores/useStudyStore';
import { useDrawingStore } from '../../stores/useDrawingStore';
import ChartCanvas from './ChartCanvas';
import PenToolbar, { DrawingToolInstructions } from './PenToolbar';
import QuestionPanel from './QuestionPanel';
import studyConfig from '../../config/study.json';
import './TaskPage.css';

/** Max box for chart fit (ChartCanvas scales image inside; ~same aspect as previous 700×500). */
const TASK_CHART_DISPLAY_WIDTH = 960;
const TASK_CHART_DISPLAY_HEIGHT = Math.round((500 / 700) * TASK_CHART_DISPLAY_WIDTH);

export default function TaskPage() {
  const navigate = useNavigate();
  const canvasActionsRef = useRef(null);
  const questionValidateRef = useRef(null);
  
  const [responses, setResponses] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const { 
    currentTrialIndex,
    startTrial,
    completeTrial,
    nextTrial,
    saveTrialData,
    participant,
    assignedSet,
    getSetStimuli,
  } = useStudyStore();

  const {
    startNewTrial,
    getActivities,
    getStats,
    initializeFromConfig,
  } = useDrawingStore();

  // Get stimuli from assigned set
  const stimuli = getSetStimuli();
  const currentStimulus = stimuli[currentTrialIndex];
  const totalTrials = stimuli.length;
  const isLastTrial = currentTrialIndex >= totalTrials - 1;

  // Check if participant and set are initialized
  useEffect(() => {
    if (!participant || !assignedSet) {
      navigate('/');
    }
  }, [participant, assignedSet, navigate]);

  // Initialize drawing config from study config
  useEffect(() => {
    initializeFromConfig(studyConfig);
  }, [initializeFromConfig]);

  // Start timing when trial begins
  useEffect(() => {
    if (currentStimulus) {
      startNewTrial();
      startTrial(currentStimulus.id);
    }
  }, [currentTrialIndex, currentStimulus?.id]);

  const handleCanvasReady = (actions) => {
    canvasActionsRef.current = actions;
  };

  const handleResponsesChange = (newResponses, validate) => {
    setResponses(newResponses);
    if (validate) {
      questionValidateRef.current = validate;
    }
  };

  const validateSubmission = () => {
    const stats = getStats();
    const canvasObjects = canvasActionsRef.current?.getCanvas()?.getObjects()?.length ?? 0;

    if (stats.strokeCount === 0 && canvasObjects === 0) {
      setError('Please add visual highlights on the chart before continuing.');
      return false;
    }

    if (questionValidateRef.current && !questionValidateRef.current()) {
      setError('Please answer all required questions.');
      return false;
    }

    return true;
  };

  const handleSubmit = async () => {
    setError('');
    
    if (!validateSubmission()) {
      return;
    }

    setIsSubmitting(true);

    try {
      completeTrial(currentStimulus.id);

      const canvasData = canvasActionsRef.current?.export();
      const stats = getStats();
      const activities = getActivities();

      const trialData = {
        trialId: currentStimulus.id,
        imageIndex: currentStimulus.imageIndex,
        caption: currentStimulus.caption,
        annotation: canvasData,
        responses,
        drawingActivities: activities,
        strokeCount: stats.strokeCount,
        totalPathLength: stats.totalPathLength,
        durationMs: stats.trialDurationMs,
      };

      await saveTrialData(trialData);

      if (isLastTrial) {
        navigate('/review');
      } else {
        nextTrial();
        setResponses({});
      }

    } catch (err) {
      console.error('Failed to submit trial:', err);
      setError(`Failed to save your response: ${err.message || 'Unknown error'}. Please try again.`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!currentStimulus) {
    return (
      <div className="task-page">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="task-page">
      <header className="task-header">
        <div className="progress-info">
          <span className="progress-text">
            Task {currentTrialIndex + 1} of {totalTrials}
          </span>
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${((currentTrialIndex + 1) / totalTrials) * 100}%` }}
            />
          </div>
        </div>
      </header>

      <main className="task-content">
        <div className="task-instruction-row">
          <p className="canvas-instruction-main">
            Read the caption below and draw visual highlights on the chart to help others understand the caption in a clear, friendly way.
          </p>
        </div>

        <div className="task-main-row">
          <div className="chart-section">
            <DrawingToolInstructions />
            <div className="canvas-wrapper">
              <PenToolbar
                onUndo={() => canvasActionsRef.current?.undo()}
                onRedo={() => canvasActionsRef.current?.redo()}
                onClear={() => canvasActionsRef.current?.clear()}
              />
              <ChartCanvas
                key={`canvas-${currentTrialIndex}`}
                imageUrl={currentStimulus.imageUrl}
                width={TASK_CHART_DISPLAY_WIDTH}
                height={TASK_CHART_DISPLAY_HEIGHT}
                onCanvasReady={handleCanvasReady}
              />
            </div>
            <div className="task-copy-stack">
              <div className="caption-display">
                <h2>Caption</h2>
                <p className="caption-paragraph">
                  <span className="caption-sentence caption-sentence--highlight">
                    {currentStimulus.caption}
                  </span>
                </p>
              </div>
              <div className="caption-display caption-display--question">
                <h2>Question</h2>
                <QuestionPanel
                  key={`questions-${currentTrialIndex}`}
                  hideTitle
                  onResponsesChange={handleResponsesChange}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            {error && (
              <div className="error-banner task-error-banner">
                {error}
              </div>
            )}

            <button
              type="button"
              className="btn btn-primary btn-submit"
              onClick={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Saving...' : isLastTrial ? 'Finish Study' : 'Next Task'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
