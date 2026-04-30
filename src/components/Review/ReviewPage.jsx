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
  const [generationStatus, setGenerationStatus] = useState({});
  const [generatedImages, setGeneratedImages] = useState({});
  const [rowOrder, setRowOrder] = useState({});

  const { 
    participant,
    assignedSet,
    getSetStimuli,
    saveReviewData,
    sessionDocId,
  } = useStudyStore();

  const stimuli = getSetStimuli();

  // Generate random order for each stimulus (once on mount)
  useEffect(() => {
    const orders = {};
    stimuli.forEach(stimulus => {
      // Randomly decide if Version 1 comes first (true) or Version 2 comes first (false)
      orders[stimulus.id] = Math.random() < 0.5;
    });
    setRowOrder(orders);
  }, []);

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

  // Polling for generation status (5초마다 확인, 모두 완료되면 중단)
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
            const data = docSnap.data();
            const generation = data.generation || {};
            
            setGenerationStatus(prev => ({
              ...prev,
              [stimulus.id]: generation.status || 'pending'
            }));

            if (generation.status === 'completed') {
              setGeneratedImages(prev => ({
                ...prev,
                [stimulus.id]: {
                  url1: generation.reviewImageUrl1,
                  url2: generation.reviewImageUrl2,
                }
              }));
            } else if (generation.status === 'processing' || generation.status === 'pending' || !generation.status) {
              allCompleted = false;
            }

            if (generation.status === 'failed') {
              console.error(`Generation failed for ${stimulus.id}:`, generation.errorMessage);
            }
          } else {
            allCompleted = false;
          }
        } catch (error) {
          console.error(`Error checking trial ${stimulus.id}:`, error);
          allCompleted = false;
        }
      }

      // 모두 완료되면 polling 중단
      if (allCompleted && intervalId) {
        clearInterval(intervalId);
        console.log('All generations completed, stopping polling');
      }
    };

    // 초기 확인
    checkGenerationStatus();

    // 5초마다 확인
    intervalId = setInterval(checkGenerationStatus, 5000);

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [sessionDocId, stimuli]);

  const handleResponseChange = (trialId, questionId, value, chartIndex = null) => {
    const key = chartIndex !== null 
      ? `${trialId}_${chartIndex}_${questionId}`
      : `${trialId}_${questionId}`;
    setResponses(prev => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors(prev => ({ ...prev, [key]: null }));
    }
  };

  const validateSubmission = () => {
    const reviewQuestions = questionsConfig.review?.questions || [];
    const newErrors = {};
    
    // Check if any images are still generating
    const stillGenerating = stimuli.some(stimulus => {
      const status = generationStatus[stimulus.id];
      return status === 'processing' || status === 'pending' || !status;
    });

    if (stillGenerating) {
      setError('Please wait for all annotations to finish generating before submitting.');
      return false;
    }
    
    stimuli.forEach(stimulus => {
      const status = generationStatus[stimulus.id];
      
      // Skip validation for stimuli that are still generating or failed
      if (status === 'processing' || status === 'pending' || !status) {
        return;
      }

      reviewQuestions.forEach(q => {
        if (q.required) {
          if (q.type === 'radio_comparison') {
            // Radio comparison: one answer per stimulus
            const key = `${stimulus.id}_${q.id}`;
            if (!responses[key]) {
              newErrors[key] = 'Required';
            }
          } else {
            // Likert and text: one answer per chart (2 charts per stimulus)
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
        rowOrder: rowOrder, // Save the randomized order for each stimulus
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

  const renderQuestionCell = (trialId, chartIndex, question, isGenerating) => {
    const key = question.type === 'radio_comparison' 
      ? `${trialId}_${question.id}`
      : `${trialId}_${chartIndex}_${question.id}`;
    
    switch (question.type) {
      case 'radio_comparison':
        return (
          <div className="review-radio-cell">
            <input
              type="radio"
              name={`${trialId}_${question.id}`}
              value={chartIndex}
              checked={responses[key] === chartIndex}
              onChange={() => handleResponseChange(trialId, question.id, chartIndex)}
              disabled={isSubmitting || isGenerating}
              className="review-radio-input"
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
                    onChange={() => handleResponseChange(trialId, question.id, value, chartIndex)}
                    disabled={isSubmitting || isGenerating}
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
            onChange={(e) => handleResponseChange(trialId, question.id, e.target.value, chartIndex)}
            placeholder={isGenerating ? 'Please wait for image generation...' : (question.placeholder || '')}
            maxLength={question.maxLength || 500}
            disabled={isSubmitting || isGenerating}
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
                  <th className="review-th-image">Generated Annotations</th>
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
                {[1, 2].map(displayIndex => {
                  const status = generationStatus[stimulus.id];
                  const images = generatedImages[stimulus.id];
                  // Only disable if actively processing
                  const isGenerating = status === 'processing';
                  
                  // Determine actual chartIndex based on randomized order
                  // If rowOrder[stimulus.id] is true: display order is [1, 2]
                  // If rowOrder[stimulus.id] is false: display order is [2, 1]
                  const chartIndex = rowOrder[stimulus.id] 
                    ? displayIndex 
                    : (3 - displayIndex); // 1->2, 2->1
                  
                  // Determine which image to show
                  let imageUrl = stimulus.imageUrl; // Fallback
                  if (status === 'completed' && images) {
                    // chartIndex 1: version without worker drawing
                    // chartIndex 2: version with worker drawing
                    imageUrl = chartIndex === 1 ? images.url1 : images.url2;
                  }

                  return (
                    <tr key={displayIndex} className={isGenerating ? 'review-row-disabled' : ''}>
                      <td className="review-td-image">
                        {isGenerating ? (
                          <div className="generation-loading">
                            <div className="spinner"></div>
                            <p>Generating annotation...</p>
                          </div>
                        ) : status === 'failed' ? (
                          <div className="generation-error">
                            <p>⚠️ Generation failed</p>
                            <img 
                              src={stimulus.imageUrl}
                              alt={`Original chart ${index + 1}`}
                              className="review-row-img"
                            />
                          </div>
                        ) : (
                          <img 
                            src={imageUrl}
                            alt={`Annotated chart ${index + 1}-${chartIndex}`}
                            className="review-row-img"
                          />
                        )}
                      </td>

                    {reviewQuestions.map(q => {
                      const key = q.type === 'radio_comparison' 
                        ? `${stimulus.id}_${q.id}`
                        : `${stimulus.id}_${chartIndex}_${q.id}`;
                      return (
                        <td 
                          key={q.id} 
                          className={`review-td-question ${errors[key] ? 'has-error' : ''} ${isGenerating ? 'disabled' : ''}`}
                        >
                          {renderQuestionCell(stimulus.id, chartIndex, q, isGenerating)}
                          {errors[key] && !isGenerating && (
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

        {/* Generation status summary */}
        {(() => {
          const generatingCount = stimuli.filter(s => {
            const status = generationStatus[s.id];
            return status === 'processing' || status === 'pending' || !status;
          }).length;
          
          if (generatingCount > 0) {
            return (
              <div className="review-status-banner">
                <div className="spinner-small"></div>
                <span>Generating {generatingCount} annotation{generatingCount > 1 ? 's' : ''}... Please wait before submitting.</span>
              </div>
            );
          }
          return null;
        })()}

        {error && (
          <div className="review-error-banner">
            {error}
          </div>
        )}

        <button
          className="review-submit-btn"
          onClick={handleSubmit}
          disabled={isSubmitting || stimuli.some(s => {
            const status = generationStatus[s.id];
            return status === 'processing' || status === 'pending' || !status;
          })}
        >
          {isSubmitting ? 'Saving...' : 'Submit Review'}
        </button>
      </main>
    </div>
  );
}
