import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStudyStore } from '../../stores/useStudyStore';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import './ReviewPage.css';

const LIKERT_QUESTION = 'This annotation helps readers understand the caption more easily.';
const REASON_QUESTION = 'Please provide brief reasons for your score.';
const LIKERT_SCALE = 7;
const DISPLAY_LABELS = ['A', 'B', 'C'];

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function ReviewPage() {
  const navigate = useNavigate();

  const [responses, setResponses] = useState({});
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [trialIntents, setTrialIntents] = useState({});
  const [generationStatus, setGenerationStatus] = useState({});
  const [generatedImages, setGeneratedImages] = useState({});
  const [imageOrder, setImageOrder] = useState({}); // per-stimulus shuffled column order v1|v2|v3 → Image A/B/C

  const { participant, assignedSet, getSetStimuli, saveReviewData, sessionDocId } = useStudyStore();
  const stimuli = getSetStimuli();

  // Assign random display order for each stimulus (once on mount)
  useEffect(() => {
    if (stimuli.length === 0) return;
    const orders = {};
    stimuli.forEach(stimulus => {
      orders[stimulus.id] = shuffleArray(['v1', 'v2', 'v3']);
    });
    setImageOrder(orders);
  }, [stimuli.length]);

  useEffect(() => {
    if (!participant || !assignedSet || stimuli.length === 0) {
      navigate('/');
      return;
    }

    const loadTrialIntents = async () => {
      const intents = {};
      for (const stimulus of stimuli) {
        const trialDocId = `${sessionDocId}_${stimulus.id}`;
        try {
          const trialDoc = await getDoc(doc(db, 'trials', trialDocId));
          if (trialDoc.exists()) {
            intents[stimulus.id] = trialDoc.data().responses?.drawing_help_intent || '';
          }
        } catch (err) {
          console.error(`Failed to load intent for ${stimulus.id}:`, err);
        }
      }
      setTrialIntents(intents);
    };

    if (sessionDocId) loadTrialIntents();
  }, [participant, assignedSet, stimuli, sessionDocId, navigate]);

  // Poll Firestore for generation status every 5 seconds
  useEffect(() => {
    if (!sessionDocId || stimuli.length === 0) return;
    let intervalId = null;

    const checkGenerationStatus = async () => {
      let allCompleted = true;

      for (const stimulus of stimuli) {
        const trialDocId = `${sessionDocId}_${stimulus.id}`;
        try {
          const docSnap = await getDoc(doc(db, 'trials', trialDocId));
          if (docSnap.exists()) {
            const generation = docSnap.data().generation || {};
            setGenerationStatus(prev => ({ ...prev, [stimulus.id]: generation.status || 'pending' }));
            if (generation.status === 'completed') {
              setGeneratedImages(prev => ({
                ...prev,
                [stimulus.id]: {
                  url1: generation.reviewImageUrl1,
                  url2: generation.reviewImageUrl2,
                },
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
  }, [sessionDocId, stimuli]);

  const getImageUrl = (stimulus, versionKey) => {
    const images = generatedImages[stimulus.id];
    if (versionKey === 'v1') return images?.url1 || null;
    if (versionKey === 'v2') return images?.url2 || null;
    if (versionKey === 'v3') return `/base_images/suneung${stimulus.imageIndex}_${stimulus.captionIndex}.png`;
    return null;
  };

  const setResponse = (stimulusId, versionKey, field, value) => {
    const key = `${stimulusId}_${versionKey}_${field}`;
    setResponses(prev => ({ ...prev, [key]: value }));
    setErrors(prev => ({ ...prev, [key]: null }));
  };

  const validateSubmission = () => {
    const stillGenerating = stimuli.some(s => {
      const status = generationStatus[s.id];
      return status === 'processing' || status === 'pending' || !status;
    });

    if (stillGenerating) {
      setError('Please wait for all annotations to finish generating before submitting.');
      return false;
    }

    const newErrors = {};
    const versions = ['v1', 'v2', 'v3'];

    stimuli.forEach(stimulus => {
      // Check Likert and reason per version
      versions.forEach(v => {
        const likertKey = `${stimulus.id}_${v}_understanding`;
        const reasonKey = `${stimulus.id}_${v}_reason`;
        if (!responses[likertKey]) newErrors[likertKey] = 'Required';
        if (!responses[reasonKey]?.trim()) newErrors[reasonKey] = 'Required';
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

  const isAnyGenerating = stimuli.some(s => {
    const status = generationStatus[s.id];
    return status === 'processing' || status === 'pending' || !status;
  });

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
          const isGenerating = status === 'processing' || status === 'pending' || !status;
          const order = imageOrder[stimulus.id] || ['v1', 'v2', 'v3'];

          return (
            <div key={stimulus.id} className="review-trial-section">
              <div className="review-caption-info">
                <p className="review-caption-text">
                  <strong>Caption:</strong> {stimulus.caption}
                </p>
                {trialIntents[stimulus.id] && (
                  <p className="review-intent-text">
                    <strong>Your Intent:</strong> {trialIntents[stimulus.id]}
                  </p>
                )}
              </div>

              {/* ── Per-image questions ── */}
              <div className="review-cards-container">
                {order.map((versionKey, idx) => {
                  const label = DISPLAY_LABELS[idx];
                  const isV3 = versionKey === 'v3';
                  const cardGenerating = !isV3 && isGenerating;
                  const imageUrl = getImageUrl(stimulus, versionKey);
                  const likertKey = `${stimulus.id}_${versionKey}_understanding`;
                  const reasonKey = `${stimulus.id}_${versionKey}_reason`;

                  return (
                    <div key={versionKey} className={`review-card ${cardGenerating ? 'review-card-loading' : ''}`}>
                      {/* Image */}
                      <div className="review-card-image">
                        {cardGenerating ? (
                          <div className="generation-loading">
                            <div className="spinner"></div>
                            <p>Generating annotation...</p>
                          </div>
                        ) : status === 'failed' && !isV3 ? (
                          <div className="generation-error">
                            <p>⚠️ Generation failed. Please wait for 1 minute. Image will be generated again.</p>
                          </div>
                        ) : imageUrl ? (
                          <img
                            src={imageUrl}
                            alt={`Annotated chart Image ${label}`}
                            className="review-card-img"
                          />
                        ) : null}
                      </div>

                      {/* 7-point Likert */}
                      <div className={`review-card-question ${errors[likertKey] ? 'has-error' : ''}`}>
                        <label className="review-question-label">{LIKERT_QUESTION}</label>
                        <div className="review-likert-7-options">
                          {Array.from({ length: LIKERT_SCALE }, (_, i) => i + 1).map(val => (
                            <label key={val} className="review-likert-7-option">
                              <span className="review-likert-num">{val}</span>
                              <input
                                type="radio"
                                name={likertKey}
                                value={val}
                                checked={responses[likertKey] === val}
                                onChange={() => setResponse(stimulus.id, versionKey, 'understanding', val)}
                                disabled={isSubmitting || cardGenerating}
                              />
                            </label>
                          ))}
                        </div>
                        <div className="review-likert-7-labels">
                          <span>Strongly Disagree</span>
                          <span>Neutral</span>
                          <span>Strongly Agree</span>
                        </div>
                        {errors[likertKey] && <span className="review-error-text">{errors[likertKey]}</span>}
                      </div>

                      {/* Text reason */}
                      <div className={`review-card-question ${errors[reasonKey] ? 'has-error' : ''}`}>
                        <label className="review-question-label">{REASON_QUESTION}</label>
                        <textarea
                          className="review-text-input"
                          value={responses[reasonKey] || ''}
                          onChange={e => setResponse(stimulus.id, versionKey, 'reason', e.target.value)}
                          placeholder="Briefly explain your rating..."
                          maxLength={500}
                          disabled={isSubmitting || cardGenerating}
                          rows={3}
                        />
                        {errors[reasonKey] && <span className="review-error-text">{errors[reasonKey]}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {isAnyGenerating && (
          <div className="review-status-banner">
            <div className="spinner-small"></div>
            <span>Generating annotations... Please wait before submitting.</span>
          </div>
        )}

        {error && <div className="review-error-banner">{error}</div>}

        <button
          className="review-submit-btn"
          onClick={handleSubmit}
          disabled={isSubmitting || isAnyGenerating}
        >
          {isSubmitting ? 'Saving...' : 'Submit Review'}
        </button>
      </main>
    </div>
  );
}