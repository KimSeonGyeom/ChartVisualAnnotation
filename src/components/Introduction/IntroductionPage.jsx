import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useStudyStore } from '../../stores/useStudyStore';
import studyConfig from '../../config/study.json';
import './IntroductionPage.css';

export default function IntroductionPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  const [prolificId, setProlificId] = useState('');
  const [consentChecked, setConsentChecked] = useState(false);
  const [chartExperience, setChartExperience] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { 
    initializeSession, 
    setConsent, 
    loadSuneungData,
    assignSet,
  } = useStudyStore();

  // Extract Prolific parameters from URL
  useEffect(() => {
    const pid = searchParams.get('PROLIFIC_PID') || searchParams.get('prolific_pid') || '';
    if (pid) {
      setProlificId(pid);
    }
  }, [searchParams]);

  // Load suneung data on mount
  useEffect(() => {
    loadSuneungData().catch(err => {
      console.error('Failed to load suneung data:', err);
    });
  }, [loadSuneungData]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Validation
    if (!prolificId.trim()) {
      setError('Please enter your Prolific ID');
      return;
    }
    if (!consentChecked) {
      setError('Please agree to the consent to continue');
      return;
    }
    if (!chartExperience) {
      setError('Please select your chart experience level');
      return;
    }

    setError('');
    setIsLoading(true);
    setConsent(true);

    try {
      // 1. Assign a set first
      await assignSet(prolificId);
      
      // 2. Initialize Firebase session with chart experience
      const studyId = searchParams.get('STUDY_ID') || 'default_study';
      const sessionId = searchParams.get('SESSION_ID') || `session_${Date.now()}`;
      await initializeSession(prolificId, studyId, sessionId, chartExperience);
      
      // 3. Go to tutorial
      navigate('/tutorial');
    } catch (err) {
      console.error('Failed to start session:', err);
      if (err.message === 'No available sets') {
        setError('All study slots are currently filled. Please try again later.');
      } else {
        setError('Failed to start session. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const { consent } = studyConfig;

  return (
    <div className="introduction-page">
      <div className="container">
        <header className="study-header">
          <h1>{studyConfig.title}</h1>
          <p className="estimated-time">
            Estimated time: ~{studyConfig.estimatedMinutes} minutes
          </p>
        </header>

        <form onSubmit={handleSubmit}>
          {/* Study Description */}
          <section className="study-description">
            <h2>Welcome!</h2>
            <p>{studyConfig.description}</p>
            
            <div className="instructions">
              <h3>What you will do:</h3>
              <ol>
                <li>View a chart image with a caption describing an insight</li>
                <li>Add visual highlights on the chart to help others understand the caption in a clear, friendly way</li>
                <li>Answer a few questions about your highlights and experience</li>
                <li>Repeat for several chart-caption pairs</li>
                <li>Review and evaluate generated visual annotations for each chart</li>
              </ol>
            </div>

            <div className="system-requirements">
              <h3>System Requirements:</h3>
              <p><strong>This study requires a screen width of at least 1200px (laptop or desktop).</strong></p>
              <p>Please use a laptop or desktop computer. Mobile devices and tablets are not supported.</p>
            </div>
          </section>

          {/* Consent */}
          <section className="consent-section">
            <h2>{consent.title}</h2>
            <div className="consent-content">
              {consent.content.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
            <label className="consent-checkbox">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                disabled={isLoading}
              />
              <span>
                I have read and understood the information above, and I agree to participate in this study.
              </span>
            </label>
          </section>

          {/* Prolific ID */}
          <section className="id-section">
            <div className="form-group">
              <label htmlFor="prolificId">
                Prolific ID <span className="required">*</span>
              </label>
              <input
                type="text"
                id="prolificId"
                value={prolificId}
                onChange={(e) => setProlificId(e.target.value)}
                placeholder="Enter your Prolific ID"
                disabled={isLoading}
              />
            </div>
          </section>

          {/* Chart Experience */}
          <section className="experience-section">
            <div className="form-group">
              <label htmlFor="chartExperience">
                How often do you work with charts or data visualizations? <span className="required">*</span>
              </label>
              <select
                id="chartExperience"
                value={chartExperience}
                onChange={(e) => setChartExperience(e.target.value)}
                disabled={isLoading}
              >
                <option value="">Select...</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="rarely">Rarely</option>
                <option value="never">Never</option>
              </select>
            </div>
          </section>

          {/* Error */}
          {error && <p className="error-message">{error}</p>}

          {/* Submit */}
          <button 
            type="submit" 
            className="btn btn-primary btn-large"
            disabled={!consentChecked || !chartExperience || isLoading}
          >
            {isLoading ? 'Preparing your session...' : 'Start Study'}
          </button>
        </form>
      </div>
    </div>
  );
}
