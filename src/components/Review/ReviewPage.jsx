import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStudyStore, getChartAssetFolder } from '../../stores/useStudyStore';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import questionsConfig from '../../config/questions.json';
import './ReviewPage.css';

const REVIEW_CONFIG = questionsConfig.review;
/** Ordered likert + text pairs (Firestore keys: trialId_v_exp_understanding, …_understanding_reason, …). */
const REVIEW_FIELDS = REVIEW_CONFIG?.questions || [];
const DEFAULT_LIKERT_SCALE =
  REVIEW_FIELDS.find((q) => q.type === 'likert')?.scale ?? 7;
const DISPLAY_LABELS = ['A', 'B'];
/** Review columns: Gemini experimental vs static baseline PNG; order is randomized per stimulus. */
const REVIEW_VARIANTS = ['v_exp', 'v_base'];

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function hasGenerationResult(stimulusId, generationStatus, imgExpUrls) {
  const st = generationStatus[stimulusId];
  const url = imgExpUrls[stimulusId];
  return st === 'completed' && typeof url === 'string' && url.trim().length > 0;
}

export default function ReviewPage() {
  const navigate = useNavigate();

  const [responses, setResponses] = useState({});
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [generationStatus, setGenerationStatus] = useState({});
  const [imgExpUrls, setImageExpUrls] = useState({});
  const [imageOrder, setImageOrder] = useState({});

  const { participant, assignedSet, getSetStimuli, saveReviewData } = useStudyStore();
  const prolificId = participant?.prolificId;
  const stimuli = getSetStimuli();

  useEffect(() => {
    if (stimuli.length === 0) return;
    const orders = {};
    stimuli.forEach((stimulus) => {
      orders[stimulus.id] = shuffleArray([...REVIEW_VARIANTS]);
    });
    setImageOrder(orders);
  }, [stimuli.length]);

  useEffect(() => {
    if (!participant || !assignedSet || stimuli.length === 0) {
      navigate('/');
      return;
    }
  }, [participant, assignedSet, stimuli, navigate]);

  useEffect(() => {
    if (!prolificId || stimuli.length === 0) return;
    let intervalId = null;

    const checkGenerationStatus = async () => {
      let allCompleted = true;

      for (const stimulus of stimuli) {
        const trialDocId = `${prolificId}_${stimulus.id}`;
        try {
          const docSnap = await getDoc(doc(db, 'trials', trialDocId));
          if (docSnap.exists()) {
            const generation = docSnap.data().generation || {};
            setGenerationStatus(prev => ({ ...prev, [stimulus.id]: generation.status || 'pending' }));
            if (generation.status === 'completed') {
              setImageExpUrls((prev) => ({
                ...prev,
                [stimulus.id]: generation.imgExp,
              }));
            } else if (generation.status !== 'failed') {
              allCompleted = false;
            }
          } else {
            allCompleted = false;
          }
        } catch (err) {
          console.error(`Error checking trial ${stimulus.id}:`, err);
          allCompleted = false;
        }
      }

      if (allCompleted && intervalId) {
        clearInterval(intervalId);
      }
    };

    checkGenerationStatus();
    intervalId = setInterval(checkGenerationStatus, 5000);
    return () => { if (intervalId) clearInterval(intervalId); };
  }, [prolificId, stimuli]);

  const getImageUrl = (stimulus, versionKey) => {
    if (versionKey === 'v_exp') return imgExpUrls[stimulus.id];
    if (versionKey === 'v_base') {
      const folder = getChartAssetFolder();
      return `/${folder}/baseImages/${stimulus.imageIndex}.png`;
    }
    return '';
  };

  const setResponse = (stimulusId, versionKey, fieldId, value) => {
    const key = `${stimulusId}_${versionKey}_${fieldId}`;
    setResponses((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: null }));
  };

  const validateSubmission = () => {
    const blocked = stimuli.some((s) => {
      const st = generationStatus[s.id];
      if (st === 'failed') return true;
      return !hasGenerationResult(s.id, generationStatus, imgExpUrls);
    });

    if (blocked) {
      setError('Please wait for all annotations to finish generating before submitting.');
      return false;
    }

    const newErrors = {};

    stimuli.forEach((stimulus) => {
      REVIEW_VARIANTS.forEach((v) => {
        REVIEW_FIELDS.forEach((q) => {
          if (q.required === false) return;
          const k = `${stimulus.id}_${v}_${q.id}`;
          if (q.type === 'likert') {
            if (responses[k] === undefined || responses[k] === null || responses[k] === '') {
              newErrors[k] = 'Required';
            }
          } else if (q.type === 'text') {
            if (!String(responses[k] ?? '').trim()) newErrors[k] = 'Required';
          }
        });
      });
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    setError('');
    if (!validateSubmission()) {
      setError('Please answer all required questions for all charts.');
      return;
    }

    setIsSubmitting(true);
    try {
      await saveReviewData({
        responses,
        trials: stimuli.map(s => s.id),
        rowOrder: imageOrder,
      });
      navigate('/finish');
    } catch (err) {
      setError(`Failed to save your review: ${err.message || 'Unknown error'}. Please try again.`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (stimuli.length === 0) {
    return <div className="review-page"><div className="loading">Loading...</div></div>;
  }

  const reviewBlocked = stimuli.some((s) => {
    const st = generationStatus[s.id];
    if (st === 'failed') return true;
    return !hasGenerationResult(s.id, generationStatus, imgExpUrls);
  });

  const anyGenFailed = stimuli.some((s) => generationStatus[s.id] === 'failed');

  return (
    <div className="review-page">
      <header className="review-header">
        <h1 className="review-title">Review</h1>
        <p className="review-subtitle">
          Please evaluate the following annotated charts for each caption.
        </p>
      </header>

      <main className="review-content">
        {stimuli.map((stimulus) => {
          const status = generationStatus[stimulus.id];
          const order = imageOrder[stimulus.id] || [...REVIEW_VARIANTS];
          const ready = hasGenerationResult(stimulus.id, generationStatus, imgExpUrls);

          return (
            <div key={stimulus.id} className="review-trial-section">
              <div className="review-caption-info">
                <p className="review-caption-text">
                  <strong>Caption:</strong> {stimulus.caption}
                </p>
              </div>

              {!ready ? (
                <div className="review-pair-gate">
                  {status === 'failed' ? (
                    <div className="generation-error review-pair-gate-inner">
                      <p>
                        ⚠️ Generation failed for this chart. Please wait or refresh; both images will appear when generation succeeds.
                      </p>
                    </div>
                  ) : (
                    <div className="generation-loading review-pair-gate-inner">
                      <div className="spinner" />
                      <p>Generating annotation… Both images will appear when ready.</p>
                    </div>
                  )}
                </div>
              ) : (
              <div className="review-cards-container">
                {order.map((versionKey, idx) => {
                  const label = DISPLAY_LABELS[idx];
                  const imageUrl = getImageUrl(stimulus, versionKey);

                  return (
                    <div key={versionKey} className="review-card">
                      <div className="review-card-image">
                        {imageUrl ? (
                          <img
                            src={imageUrl}
                            alt={`Annotated chart Image ${label}`}
                            className="review-card-img"
                          />
                        ) : null}
                      </div>

                      {REVIEW_FIELDS.map((q) => {
                        const fieldKey = `${stimulus.id}_${versionKey}_${q.id}`;
                        if (q.type === 'likert') {
                          const scale = q.scale ?? DEFAULT_LIKERT_SCALE;
                          return (
                            <div
                              key={q.id}
                              className={`review-card-question ${errors[fieldKey] ? 'has-error' : ''}`}
                            >
                              <label className="review-question-label">{q.question}</label>
                              <div className="review-likert-7-options">
                                {Array.from({ length: scale }, (_, i) => i + 1).map((val) => (
                                  <label key={val} className="review-likert-7-option">
                                    <span className="review-likert-num">{val}</span>
                                    <input
                                      type="radio"
                                      name={fieldKey}
                                      value={val}
                                      checked={responses[fieldKey] === val}
                                      onChange={() => setResponse(stimulus.id, versionKey, q.id, val)}
                                      disabled={isSubmitting}
                                    />
                                  </label>
                                ))}
                              </div>
                              <div className="review-likert-7-labels">
                                <span>Strongly Disagree</span>
                                <span>Neutral</span>
                                <span>Strongly Agree</span>
                              </div>
                              {errors[fieldKey] && (
                                <span className="review-error-text">{errors[fieldKey]}</span>
                              )}
                            </div>
                          );
                        }
                        if (q.type === 'text') {
                          return (
                            <div
                              key={q.id}
                              className={`review-card-question ${errors[fieldKey] ? 'has-error' : ''}`}
                            >
                              <label className="review-question-label">{q.question}</label>
                              <textarea
                                className="review-text-input"
                                value={responses[fieldKey] || ''}
                                onChange={(e) => setResponse(stimulus.id, versionKey, q.id, e.target.value)}
                                placeholder={q.placeholder || ''}
                                maxLength={q.maxLength ?? 500}
                                disabled={isSubmitting}
                                rows={3}
                              />
                              {errors[fieldKey] && (
                                <span className="review-error-text">{errors[fieldKey]}</span>
                              )}
                            </div>
                          );
                        }
                        return null;
                      })}
                    </div>
                  );
                })}
              </div>
              )}
            </div>
          );
        })}

        {reviewBlocked && (
          <div className="review-status-banner">
            {!anyGenFailed && <div className="spinner-small"></div>}
            <span>
              {anyGenFailed
                ? 'Some charts could not be generated. Please refresh the page or contact the researcher; submit stays disabled until all charts are ready.'
                : 'Waiting for generated images… Please wait before submitting.'}
            </span>
          </div>
        )}

        {error && <div className="review-error-banner">{error}</div>}

        <button
          className="review-submit-btn"
          onClick={handleSubmit}
          disabled={isSubmitting || reviewBlocked}
        >
          {isSubmitting ? 'Saving...' : 'Submit Review'}
        </button>
      </main>
    </div>
  );
}