import { useState, useEffect } from 'react';
import questionsConfig from '../../config/questions.json';

export default function QuestionPanel({ onResponsesChange, disabled = false }) {
  const [responses, setResponses] = useState({});
  const [errors, setErrors] = useState({});

  const { questions } = questionsConfig;

  useEffect(() => {
    // Reset responses when component mounts (new trial)
    setResponses({});
    setErrors({});
  }, []);

  const handleChange = (questionId, value) => {
    const newResponses = { ...responses, [questionId]: value };
    setResponses(newResponses);
    
    // Clear error
    if (errors[questionId]) {
      setErrors(prev => ({ ...prev, [questionId]: null }));
    }

    // Notify parent
    if (onResponsesChange) {
      onResponsesChange(newResponses);
    }
  };

  const validate = () => {
    const newErrors = {};
    questions.forEach(q => {
      if (q.required && !responses[q.id]) {
        newErrors[q.id] = 'This field is required';
      }
    });
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Expose validate method
  useEffect(() => {
    if (onResponsesChange) {
      onResponsesChange(responses, validate);
    }
  }, [responses]);

  const renderQuestion = (question) => {
    switch (question.type) {
      case 'single-choice':
        return (
          <div className="options-list">
            {question.options.map((option) => (
              <label key={option.value} className="radio-option">
                <input
                  type="radio"
                  name={question.id}
                  value={option.value}
                  checked={responses[question.id] === option.value}
                  onChange={(e) => handleChange(question.id, e.target.value)}
                  disabled={disabled}
                />
                <span className="radio-label">{option.label}</span>
              </label>
            ))}
          </div>
        );

      case 'likert':
        return (
          <div className="likert-scale">
            <span className="anchor anchor-low">{question.anchors.low}</span>
            <div className="likert-options">
              {Array.from({ length: question.scale }, (_, i) => i + 1).map((value) => (
                <label key={value} className="likert-option">
                  <input
                    type="radio"
                    name={question.id}
                    value={value}
                    checked={responses[question.id] === value}
                    onChange={() => handleChange(question.id, value)}
                    disabled={disabled}
                  />
                  <span className="likert-value">{value}</span>
                </label>
              ))}
            </div>
            <span className="anchor anchor-high">{question.anchors.high}</span>
          </div>
        );

      case 'text':
        return (
          <textarea
            value={responses[question.id] || ''}
            onChange={(e) => handleChange(question.id, e.target.value)}
            placeholder={question.placeholder || ''}
            maxLength={question.maxLength || 500}
            disabled={disabled}
            className="text-response"
          />
        );

      default:
        return null;
    }
  };

  return (
    <div className="question-panel">
      <h3>Questions</h3>
      
      {questions.map((question) => (
        <div key={question.id} className={`question-item ${errors[question.id] ? 'has-error' : ''}`}>
          <label className="question-label">
            {question.question}
            {question.required && <span className="required">*</span>}
          </label>
          
          {renderQuestion(question)}
          
          {errors[question.id] && (
            <span className="error-message">{errors[question.id]}</span>
          )}
        </div>
      ))}
    </div>
  );
}

