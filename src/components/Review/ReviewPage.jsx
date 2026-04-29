import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStudyStore } from '../../stores/useStudyStore';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import questionsConfig from '../../config/questions.json';
import './ReviewPage.css';

export default function ReviewPage() {
  const navigate = useNavigate();
  
  const [responses, setResponses] = useState({});
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [trialIntents, setTrialIntents] = useState({});

  const { 
    participant,
    assignedSet,
    getSetStimuli,
    saveReviewData,
    sessionDocId,
  } = useStudyStore();

  const stimuli = getSetStimuli();

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
            const data = trialDoc.data();
            intents[stimulus.id] = data.responses?.drawing_help_intent || '';
          }
        } catch (err) {
          console.error(`Failed to load intent for ${stimulus.id}:`, err);
        }
      }
      setTrialIntents(intents);
    };

    if (sessionDocId) {
      loadTrialIntents();
    }
  }, [participant, assignedSet, stimuli, sessionDocId, navigate]);

  const handleResponseChange = (trialId, chartIndex, questionId, value) => {
    const key = `${trialId}_${chartIndex}_${questionId}`;
    setResponses(prev => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors(prev => ({ ...prev, [key]: null }));
    }
  };

  const validateSubmission = () => {
    const reviewQuestions = questionsConfig.review?.questions || [];
    const newErrors = {};
    
    stimuli.forEach(stimulus => {
      reviewQuestions.forEach(q => {
        if (q.required) {
          if (q.type === 'radio_comparison') {
            const key = `${stimulus.id}_${q.id}`;
            if (!responses[key]) {
              newErrors[key] = 'Required';
            }
          } else {
            [1, 2].forEach(chartIndex => {
              const key = `${stimulus.id}_${chartIndex}_${q.id}`;
              if (!responses[key]) {
                newErrors[key] = 'Required';
              }
            });
          }
        }
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
      const reviewData = {
        responses: responses,
        trials: stimuli.map(s => s.id),
      };

      await saveReviewData(reviewData);
      navigate('/finish');

    } catch (err) {
      console.error('Failed to submit review:', err);
      setError(`Failed to save your review: ${err.message || 'Unknown error'}. Please try again.`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderQuestionCell = (trialId, chartIndex, question) => {
    const key = `${trialId}_${chartIndex}_${question.id}`;
    
    switch (question.type) {
      case 'radio_comparison':
        const comparisonKey = `${trialId}_${question.id}`;
        return (
          <div className="review-radio-comparison">
            <input
              type="radio"
              name={comparisonKey}
              value={chartIndex}
              checked={responses[comparisonKey] === chartIndex}
              onChange={() => {
                setResponses(prev => ({ ...prev, [comparisonKey]: chartIndex }));
                if (errors[comparisonKey]) {
                  setErrors(prev => ({ ...prev, [comparisonKey]: null }));
                }
              }}
              disabled={isSubmitting}
            />
          </div>
        );

      case 'likert':
        return (
          <div className="review-likert-cell">
            <div className="review-likert-options">
              {Array.from({ length: question.scale }, (_, i) => i + 1).map((value) => (
                <label key={value} className="review-likert-option">
                  <span className="review-likert-num">{value}</span>
                  <input
                    type="radio"
                    name={key}
                    value={value}
                    checked={responses[key] === value}
                    onChange={() => handleResponseChange(trialId, chartIndex, question.id, value)}
                    disabled={isSubmitting}
                  />
                </label>
              ))}
            </div>
            <div className="review-likert-labels">
              <span className="review-likert-label-left">{question.labels[0]}</span>
              <span className="review-likert-label-left"></span>
              <span className="review-likert-label-center">{question.labels[2]}</span>
              <span className="review-likert-label-center"></span>
              <span className="review-likert-label-right">{question.labels[4]}</span>
            </div>
          </div>
        );

      case 'text':
        return (
          <textarea
            value={responses[key] || ''}
            onChange={(e) => handleResponseChange(trialId, chartIndex, question.id, e.target.value)}
            placeholder={question.placeholder || ''}
            maxLength={question.maxLength || 500}
            disabled={isSubmitting}
            className="review-text-input"
            rows={3}
          />
        );

      default:
        return null;
    }
  };

  if (stimuli.length === 0) {
    return (
      <div className="review-page">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  const reviewQuestions = questionsConfig.review?.questions || [];

  return (
    <div className="review-page">
      <header className="review-header">
        <h1 className="review-title">Review</h1>
        <p className="review-subtitle">
          Please answer the following questions for each chart-caption pair you saw earlier and your intent.
        </p>
      </header>

      <main className="review-content">
        {stimuli.map((stimulus, index) => (
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
            
            <table className="review-table">
              <thead>
                <tr>
                  <th className="review-th-image">Annotated Charts</th>
                  {reviewQuestions.map(q => (
                    <th 
                      key={q.id} 
                      className={q.id === 'better_choice' ? 'review-th-narrow' : 'review-th-wide'}
                    >
                      {q.question}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[1, 2].map(chartIndex => {
                  const imageUrl = chartIndex === 1 
                    ? (stimulus.reviewImageUrl1 || stimulus.imageUrl)
                    : (stimulus.reviewImageUrl2 || stimulus.imageUrl);

                  return (
                    <tr key={chartIndex}>
                      <td className="review-td-image">
                        <img 
                          src={imageUrl}
                          alt={`Annotated chart ${index + 1}-${chartIndex}`}
                          className="review-row-img"
                        />
                      </td>

                    {reviewQuestions.map(q => {
                      const key = q.type === 'radio_comparison' 
                        ? `${stimulus.id}_${q.id}`
                        : `${stimulus.id}_${chartIndex}_${q.id}`;
                      return (
                        <td 
                          key={q.id} 
                          className={`review-td-question ${errors[key] ? 'has-error' : ''}`}
                        >
                          {renderQuestionCell(stimulus.id, chartIndex, q)}
                          {errors[key] && (
                            <span className="review-error-text">{errors[key]}</span>
                          )}
                        </td>
                      );
                    })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

        {error && (
          <div className="review-error-banner">
            {error}
          </div>
        )}

        <button
          className="review-submit-btn"
          onClick={handleSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Saving...' : 'Submit Review'}
        </button>
      </main>
    </div>
  );
}
