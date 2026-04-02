import { useEffect, useState } from 'react';
import { useStudyStore } from '../../stores/useStudyStore';
import studyConfig from '../../config/study.json';
import './FinishPage.css';

export default function FinishPage() {
  const [isFinalized, setIsFinalized] = useState(false);
  const [error, setError] = useState('');
  
  const { finalizeSession } = useStudyStore();

  useEffect(() => {
    const finalize = async () => {
      try {
        await finalizeSession();
        setIsFinalized(true);
      } catch (err) {
        console.error('Failed to finalize session:', err);
        setError('There was an issue saving your final data, but your responses have been recorded.');
        setIsFinalized(true);
      }
    };

    finalize();
  }, [finalizeSession]);

  const handleRedirect = () => {
    window.location.href = studyConfig.prolificCompletionUrl;
  };

  return (
    <div className="finish-page">
      <div className="finish-container">
        <div className="success-icon">
          <svg viewBox="0 0 24 24" width="80" height="80" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
          </svg>
        </div>

        <h1>Thank You!</h1>
        
        <p className="completion-message">
          Your responses have been successfully recorded. We greatly appreciate your participation in this study.
        </p>

        {error && (
          <div className="warning-message">
            {error}
          </div>
        )}

        <div className="redirect-section">
          <p className="redirect-instruction">
            Please click the button below to complete your submission on Prolific.
          </p>
          
          <button 
            className="btn btn-primary btn-large"
            onClick={handleRedirect}
            disabled={!isFinalized}
          >
            {isFinalized ? 'Complete on Prolific' : 'Saving your data...'}
          </button>

          <p className="redirect-note">
            Completion code:
          </p>
          <code className="completion-code">
            {studyConfig.prolificCompletionUrl.split('cc=')[1] || 'XXXXXXXX'}
          </code>
        </div>
      </div>
    </div>
  );
}

