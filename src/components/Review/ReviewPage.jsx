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

/** Group each likert with its following text follow-up for compact rendering. */
function groupReviewFields(fields) {
  const groups = [];
  for (let i = 0; i < fields.length; i += 1) {
    const q = fields[i];
    if (q.type === 'likert') {
      const next = fields[i + 1];
      if (next?.type === 'text') {
        groups.push({ likert: q, followUp: next });
        i += 1;
      } else {
        groups.push({ likert: q, followUp: null });
      }
    } else {
      groups.push({ likert: null, followUp: q });
    }
  }
  return groups;
}

const REVIEW_FIELD_GROUPS = groupReviewFields(REVIEW_FIELDS);

function ReviewQuestionGroups({
  stimulus,
  versionKey,
  responses,
  errors,
  isSubmitting,
  setResponse,
}) {
  return REVIEW_FIELD_GROUPS.map(({ likert, followUp }) => {
    const groupKey = likert?.id || followUp?.id;
    const likertKey = likert ? `${stimulus.id}_${versionKey}_${likert.id}` : null;
    const followKey = followUp ? `${stimulus.id}_${versionKey}_${followUp.id}` : null;

    return (
      <div
        key={groupKey}
        className={`review-question-group ${
          (likertKey && errors[likertKey]) || (followKey && errors[followKey]) ? 'has-error' : ''
        }`}
      >
        {likert && (
          <div className="review-likert-block">
            <label className="review-question-label">{likert.question}</label>
            <div className="review-likert-7-options">
              {Array.from({ length: likert.scale ?? DEFAULT_LIKERT_SCALE }, (_, i) => i + 1).map(
                (val) => (
                  <label key={val} className="review-likert-7-option">
                    <input
                      type="radio"
                      name={likertKey}
                      value={val}
                      checked={responses[likertKey] === val}
                      onChange={() => setResponse(stimulus.id, versionKey, likert.id, val)}
                      disabled={isSubmitting}
                    />
                    <span className="review-likert-num">{val}</span>
                    <span className="review-likert-7-labels">{likert.labels[val - 1]}</span>
                  </label>
                )
              )}
            </div>
            {errors[likertKey] && (
              <span className="review-error-text">{errors[likertKey]}</span>
            )}
          </div>
        )}
        {followUp && (
          <div className="review-followup-block">
            <textarea
              className="review-text-input"
              value={responses[followKey] || ''}
              onChange={(e) => setResponse(stimulus.id, versionKey, followUp.id, e.target.value)}
              placeholder={followUp.placeholder || ''}
              maxLength={followUp.maxLength ?? 500}
              disabled={isSubmitting}
              rows={2}
              aria-label={followUp.placeholder || 'Explanation'}
            />
            {errors[followKey] && (
              <span className="review-error-text">{errors[followKey]}</span>
            )}
          </div>
        )}
      </div>
    );
  });
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
  const [skippedTrials, setSkippedTrials] = useState(() => new Set());

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
      let allSettled = true;

      for (const stimulus of stimuli) {
        if (skippedTrials.has(stimulus.id)) continue;

        const trialDocId = `${prolificId}_${stimulus.id}`;
        try {
          const docSnap = await getDoc(doc(db, 'trials', trialDocId));
          if (docSnap.exists()) {
            const generation = docSnap.data().generation || {};
            const status = generation.status || 'pending';
            setGenerationStatus((prev) => ({ ...prev, [stimulus.id]: status }));
            if (status === 'completed') {
              setImageExpUrls((prev) => ({
                ...prev,
                [stimulus.id]: generation.imgExp,
              }));
            } else if (status !== 'failed') {
              allSettled = false;
            }
          } else {
            allSettled = false;
          }
        } catch (err) {
          console.error(`Error checking trial ${stimulus.id}:`, err);
          allSettled = false;
        }
      }

      if (allSettled && intervalId) {
        clearInterval(intervalId);
      }
    };

    checkGenerationStatus();
    intervalId = setInterval(checkGenerationStatus, 5000);
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [prolificId, stimuli, skippedTrials]);

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

  const handleSkipChart = (stimulusId) => {
    setSkippedTrials((prev) => new Set([...prev, stimulusId]));
    setResponses((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((key) => {
        if (key.startsWith(`${stimulusId}_`)) delete next[key];
      });
      return next;
    });
    setErrors((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((key) => {
        if (key.startsWith(`${stimulusId}_`)) delete next[key];
      });
      return next;
    });
    setError('');
  };

  const isTrialReadyForReview = (stimulusId) =>
    skippedTrials.has(stimulusId) ||
    hasGenerationResult(stimulusId, generationStatus, imgExpUrls);

  const variantsForStimulus = (stimulusId) =>
    skippedTrials.has(stimulusId) ? [] : REVIEW_VARIANTS;

  const validateSubmission = () => {
    const waiting = stimuli.some((s) => {
      if (skippedTrials.has(s.id)) return false;
      if (hasGenerationResult(s.id, generationStatus, imgExpUrls)) return false;
      if (generationStatus[s.id] === 'failed') return true;
      return true;
    });

    if (waiting) {
      const needsSkip = stimuli.some(
        (s) => !skippedTrials.has(s.id) && generationStatus[s.id] === 'failed'
      );
      setError(
        needsSkip
          ? 'Generation failed for one or more charts. Use "Skip this chart" on each failed chart to continue.'
          : 'Please wait for all annotations to finish generating before submitting.'
      );
      return false;
    }

    const newErrors = {};

    stimuli.forEach((stimulus) => {
      variantsForStimulus(stimulus.id).forEach((v) => {
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
    if (Object.keys(newErrors).length > 0) {
      setError('Please answer all required questions for all charts.');
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
      await saveReviewData({
        responses,
        trials: stimuli.map((s) => s.id),
        skippedTrials: [...skippedTrials],
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
    return (
      <div className="review-page">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  const reviewBlocked = stimuli.some((s) => {
    if (skippedTrials.has(s.id)) return false;
    if (hasGenerationResult(s.id, generationStatus, imgExpUrls)) return false;
    return true;
  });

  const anyGenFailed = stimuli.some(
    (s) => !skippedTrials.has(s.id) && generationStatus[s.id] === 'failed'
  );
  const anyWaiting = stimuli.some(
    (s) =>
      !skippedTrials.has(s.id) &&
      !hasGenerationResult(s.id, generationStatus, imgExpUrls) &&
      generationStatus[s.id] !== 'failed'
  );

  return (
    <div className="review-page">
      <header className="review-header">
        <h1 className="review-title">Review</h1>
        <p className="review-subtitle">
          Please complete the following review questions.
        </p>
      </header>

      <main className="review-content">
        {stimuli.map((stimulus) => {
          const status = generationStatus[stimulus.id];
          const isSkipped = skippedTrials.has(stimulus.id);
          const ready = isTrialReadyForReview(stimulus.id);
          const order = imageOrder[stimulus.id] || [...REVIEW_VARIANTS];
          const displayOrder = isSkipped ? [] : order;

          const captionLine = (
            <p className="review-caption-line">
              <strong>Caption:</strong> {stimulus.caption}
            </p>
          );

          return (
            <div key={stimulus.id} className="review-trial-section">
              {!ready ? (
                <div className="review-pair-gate">
                  {captionLine}
                  {status === 'failed' ? (
                    <div className="generation-error review-pair-gate-inner">
                      <p>
                        Generation could not be completed for this chart. Please wait a moment in
                        case processing is still finishing. If this message remains, you can skip
                        this chart and continue with the others.
                      </p>
                      <button
                        type="button"
                        className="btn btn-secondary review-skip-btn"
                        onClick={() => handleSkipChart(stimulus.id)}
                        disabled={isSubmitting}
                      >
                        Skip this chart
                      </button>
                    </div>
                  ) : (
                    <div className="generation-loading review-pair-gate-inner">
                      <div className="spinner" />
                      <p>Generating annotation… Please wait. Both images will appear when ready.</p>
                    </div>
                  )}
                </div>
              ) : isSkipped ? (
                <div className="review-skipped-section">
                  {captionLine}
                  <p className="review-skipped-note">
                    This chart was skipped. No review questions apply.
                  </p>
                </div>
              ) : (
                <div
                  className={`review-cards-container ${
                    displayOrder.length === 1 ? 'review-cards-container--single' : ''
                  }`}
                >
                  {displayOrder.map((versionKey, idx) => {
                    const label = DISPLAY_LABELS[idx];
                    const imageUrl = getImageUrl(stimulus, versionKey);

                    return (
                      <div key={versionKey} className="review-card">
                        <div className="review-card-image">
                          {imageUrl ? (
                            <img
                              src={imageUrl}
                              alt={`Annotated chart ${label}`}
                              className="review-card-img"
                            />
                          ) : null}
                        </div>
                        {captionLine}

                        <ReviewQuestionGroups
                          stimulus={stimulus}
                          versionKey={versionKey}
                          responses={responses}
                          errors={errors}
                          isSubmitting={isSubmitting}
                          setResponse={setResponse}
                        />
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
            {anyWaiting && <div className="spinner-small" />}
            <span>
              {anyGenFailed
                ? 'Generation failed for one or more charts. Use "Skip this chart" on each failed chart to continue.'
                : 'Waiting for generated images… Please wait before submitting.'}
            </span>
          </div>
        )}

        {error && <div className="review-error-banner">{error}</div>}

        <button
          type="button"
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
