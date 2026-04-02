import { useState, useEffect } from 'react';
import questionsConfig from '../../config/questions.json';

export default function QuestionPanel({ onResponsesChange, disabled = false }) {
  const [activeVersion, setActiveVersion] = useState(questionsConfig.versions[0].id);
  const [responses, setResponses] = useState({});
  const [errors, setErrors] = useState({});

  const { versions } = questionsConfig;

  const shouldShowQuestion = (question, currentResponses) => {
    if (!question.showIf) return true;
    return currentResponses[question.showIf.questionId] === question.showIf.value;
  };

  const buildVersionResponses = (allResponses, versionId) => {
    const versionQuestions = versions.find(v => v.id === versionId)?.questions || [];
    const result = { selectedVersion: versionId };
    versionQuestions.forEach(q => {
      if (allResponses[q.id] !== undefined) {
        result[q.id] = allResponses[q.id];
      }
    });
    return result;
  };

  const createValidate = (allResponses, versionId) => () => {
    const versionQuestions = versions.find(v => v.id === versionId)?.questions || [];
    const newErrors = {};
    versionQuestions.forEach(q => {
      if (!shouldShowQuestion(q, allResponses)) return;
      if (q.required && !allResponses[q.id]) {
        newErrors[q.id] = 'This field is required';
      }
    });
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  useEffect(() => {
    setResponses({});
    setErrors({});
  }, []);

  useEffect(() => {
    if (onResponsesChange) {
      onResponsesChange(
        buildVersionResponses(responses, activeVersion),
        createValidate(responses, activeVersion)
      );
    }
  }, [responses, activeVersion]);

  const handleChange = (questionId, value) => {
    const newResponses = { ...responses, [questionId]: value };
    setResponses(newResponses);
    if (errors[questionId]) {
      setErrors(prev => ({ ...prev, [questionId]: null }));
    }
  };

  const handleTabChange = (versionId) => {
    setActiveVersion(versionId);
    setErrors({});
  };

  const currentVersion = versions.find(v => v.id === activeVersion);

  const visibleQuestions =
    currentVersion?.questions.filter((q) => shouldShowQuestion(q, responses)) ?? [];
  const chunkIds = [...new Set(visibleQuestions.map((q) => q.chunk ?? 0))].sort(
    (a, b) => Number(a) - Number(b)
  );

  const renderQuestion = (question) => {
    switch (question.type) {
      case 'single-choice':
        return (
          <div className="options-list">
            {question.options.map((option) => (
              <label key={option.value} className="radio-option">
                <input
                  type="radio"
                  name={`${activeVersion}_${question.id}`}
                  value={option.value}
                  checked={responses[question.id] === option.value}
                  onChange={(e) => handleChange(question.id, e.target.value)}
                  disabled={disabled}
                />
                <span className="radio-label-wrapper">
                  <span className="radio-label">{option.label}</span>
                  {option.tooltip && (
                    <span className="option-tooltip-box">{option.tooltip}</span>
                  )}
                </span>
              </label>
            ))}
          </div>
        );

      case 'likert':
        return (
          <div className="likert-scale">
            {Array.from({ length: question.scale }, (_, i) => i + 1).map((value) => (
              <label key={value} className="likert-option">
                <input
                  type="radio"
                  name={`${activeVersion}_${question.id}`}
                  value={value}
                  checked={responses[question.id] === value}
                  onChange={() => handleChange(question.id, value)}
                  disabled={disabled}
                />
                <span className="likert-value">{value}</span>
                <span className="likert-anchor">
                  {question.labels?.[value - 1] ?? ''}
                </span>
              </label>
            ))}
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
      <h2 className="question-panel-title">Survey</h2>
      {chunkIds.map((chunkId) => (
        <div key={`chunk_${chunkId}`} className="question-chunk">
          {visibleQuestions
            .filter((q) => (q.chunk ?? 0) === chunkId)
            .map((question) => (
              <div
                key={`${activeVersion}_${question.id}`}
                className={`question-item ${errors[question.id] ? 'has-error' : ''}`}
              >
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
      ))}
    </div>
  );
}
