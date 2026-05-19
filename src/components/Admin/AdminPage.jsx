import { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../services/firebase';
import questionsConfig from '../../config/questions.json';
import './AdminPage.css';

/** Shown as synthetic "Tutorial" row; hide duplicate trial rows from Firestore. */
const TUTORIAL_PRACTICE_TRIAL_ID = 'tutorial_practice';

const ADMIN_PASSWORD = 'AELCVA';
const ADMIN_SESSION_KEY = 'cva_admin_ok';

/** Only list sessions for this asset folder (current pilot). */
const ADMIN_CHART_FOLDER = 'pilot_v3';

function readAdminAuthed() {
  try {
    return sessionStorage.getItem(ADMIN_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

function isHttpUrl(s) {
  return typeof s === 'string' && /^https?:\/\//i.test(s.trim());
}

function generationVersionShortLabel(chartIndex) {
  if (chartIndex === 1) return 'Baseline (baseImages)';
  if (chartIndex === 2) return 'Experimental (Gemini)';
  return `Version ${chartIndex}`;
}

function responseValuePresent(v) {
  return v !== undefined && v !== null && v !== '';
}

function formatReviewAnswerCell(question, value) {
  if (question.type === 'likert') {
    const n = Number(value);
    const label = question.labels?.[n - 1];
    return label ? `${value} (${label})` : String(value);
  }
  if (question.type === 'text') {
    return String(value);
  }
  return String(value);
}

/** Per-trial answers from session review doc — one matrix table (question × version). */
function TrialGenerationReviewAnswers({ review, trialId }) {
  const reviewQuestions = questionsConfig.review?.questions || [];
  const responses = review?.responses || {};

  if (!trialId) {
    return <p className="admin-empty">Missing trial id.</p>;
  }

  if (!review) {
    return <p className="admin-empty">No review submitted for this session.</p>;
  }

  const trialKeyPrefix = `${trialId}_`;
  const hasTrialAnswers = Object.keys(responses).some(k => k.startsWith(trialKeyPrefix));

  if (!hasTrialAnswers) {
    return <p className="admin-empty">No review answers for this trial.</p>;
  }

  const comparisonQ = reviewQuestions.find(q => q.type === 'radio_comparison');
  let comparison = null;
  if (comparisonQ) {
    const k = `${trialId}_${comparisonQ.id}`;
    const v = responses[k];
    if (responseValuePresent(v)) {
      const chartIndex = Number(v);
      comparison = {
        question: comparisonQ.question,
        chartIndex,
        label: Number.isFinite(chartIndex)
          ? generationVersionShortLabel(chartIndex)
          : String(v),
      };
    }
  }

  const perVersionQuestions = reviewQuestions.filter(q => q.type !== 'radio_comparison');

  const dash = <span className="admin-review-cell-empty">—</span>;

  return (
    <div className="admin-trial-review-answers">
      <table className="admin-table admin-review-matrix-table">
        <thead>
          <tr>
            <th scope="col" className="admin-review-matrix-th-question">Question</th>
            <th scope="col">Experimental (<code>v_exp</code>)</th>
            <th scope="col">Baseline (<code>v_base</code>)</th>
          </tr>
        </thead>
        <tbody>
          {comparison && (
            <tr key={`${trialId}_comparison`}>
              <td className="admin-table-key">{comparison.question}</td>
              <td className="admin-review-answer-text">
                {comparison.chartIndex === 1 ? comparison.label : dash}
              </td>
              <td className="admin-review-answer-text">
                {comparison.chartIndex === 2 ? comparison.label : dash}
              </td>
            </tr>
          )}
          {perVersionQuestions.map((q) => {
            const vExp = responses[`${trialId}_v_exp_${q.id}`];
            const vBase = responses[`${trialId}_v_base_${q.id}`];
            return (
              <tr key={q.id}>
                <td className="admin-table-key">{q.question}</td>
                <td className="admin-review-answer-text">
                  {responseValuePresent(vExp) ? formatReviewAnswerCell(q, vExp) : dash}
                </td>
                <td className="admin-review-answer-text">
                  {responseValuePresent(vBase) ? formatReviewAnswerCell(q, vBase) : dash}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {review.submittedAt?.toDate && (
        <p className="admin-review-meta">
          Review submitted: {review.submittedAt.toDate().toLocaleString()}
        </p>
      )}
    </div>
  );
}

/** Firestore `annotation.imageUrl` from save (token URL); optional legacy `imageData`. */
function WorkerDrawingImage({ annotation }) {
  const imageUrl = annotation?.imageUrl;
  const imageData = annotation?.imageData;

  if (isHttpUrl(imageUrl)) {
    return (
      <img
        className="admin-annotation-img"
        src={imageUrl.trim()}
        alt="Worker annotation"
        loading="lazy"
        decoding="async"
      />
    );
  }

  if (typeof imageData === 'string' && imageData.length > 0) {
    return (
      <img
        className="admin-annotation-img"
        src={imageData}
        alt="Worker annotation"
        loading="lazy"
        decoding="async"
      />
    );
  }

  return <p className="admin-empty">No image saved.</p>;
}

function TutorialDetail({ prolificId }) {
  const [tutorialImageUrl, setTutorialImageUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchTutorialImage = async () => {
      try {
        const storageRef = ref(
          storage,
          `${ADMIN_CHART_FOLDER}/${prolificId}/tutorial.jpg`
        );
        const url = await getDownloadURL(storageRef);
        setTutorialImageUrl(url);
      } catch (err) {
        console.error('Failed to load tutorial image:', err);
        setError('No tutorial image found');
      } finally {
        setLoading(false);
      }
    };

    fetchTutorialImage();
  }, [prolificId]);

  return (
    <>
      <h2 className="admin-detail-title">
        {prolificId} - Tutorial Practice
      </h2>

      <section className="admin-section">
        <h3>Tutorial Drawing</h3>
        {loading ? (
          <p>Loading...</p>
        ) : error ? (
          <p className="admin-empty">{error}</p>
        ) : (
          <img
            className="admin-annotation-img"
            src={tutorialImageUrl}
            alt="Tutorial practice drawing"
          />
        )}
      </section>

      <section className="admin-section">
        <h3>Info</h3>
        <table className="admin-table">
          <tbody>
            <tr><td className="admin-table-key">Prolific ID</td><td>{prolificId}</td></tr>
            <tr><td className="admin-table-key">Type</td><td>Tutorial Practice</td></tr>
          </tbody>
        </table>
      </section>
    </>
  );
}

export default function AdminPage() {
  const [authed, setAuthed] = useState(readAdminAuthed);
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [trials, setTrials] = useState([]);
  const [sessions, setSessions] = useState({});
  const [sets, setSets] = useState({});
  const [reviews, setReviews] = useState({});
  const [chartCaptions, setChartCaptions] = useState([]);
  const [loading, setLoading] = useState(readAdminAuthed);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [groupBy, setGroupBy] = useState('prolificId'); // 'prolificId' or 'time'

  useEffect(() => {
    if (!authed) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError('');

    const fetchData = async () => {
      try {
        const trialsQuery = query(collection(db, 'trials'), orderBy('submittedAt', 'desc'));
        const trialsSnapshot = await getDocs(trialsQuery);
        const trialsData = trialsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

        const sessionsQuery = query(collection(db, 'sessions'));
        const sessionsSnapshot = await getDocs(sessionsQuery);
        const sessionsMap = {};
        sessionsSnapshot.docs.forEach(d => {
          sessionsMap[d.id] = d.data();
        });

        const setsQuery = query(collection(db, 'sets'));
        const setsSnapshot = await getDocs(setsQuery);
        const setsMap = {};
        setsSnapshot.docs.forEach(d => {
          setsMap[d.id] = d.data();
        });

        const reviewsQuery = query(collection(db, 'reviews'));
        const reviewsSnapshot = await getDocs(reviewsQuery);
        const reviewsMap = {};
        reviewsSnapshot.docs.forEach(d => {
          reviewsMap[d.data().prolificId] = d.data();
        });

        const captionRes = await fetch(`/${ADMIN_CHART_FOLDER}/caption.json`);
        const captionJson = await captionRes.json();

        if (!cancelled) {
          setTrials(trialsData);
          setSessions(sessionsMap);
          setSets(setsMap);
          setReviews(reviewsMap);
          setChartCaptions(captionJson);
        }
      } catch (err) {
        if (!cancelled) setError('Failed to load data: ' + err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [authed]);

  const trialsSansTutorial = useMemo(
    () => trials.filter(t => t.trialId !== TUTORIAL_PRACTICE_TRIAL_ID),
    [trials]
  );

  const pilotTrials = useMemo(
    () =>
      trialsSansTutorial.filter(
        (t) => sessions[t.prolificId]?.chartAssetFolder === ADMIN_CHART_FOLDER
      ),
    [trialsSansTutorial, sessions]
  );

  useEffect(() => {
    setSelected((sel) => {
      if (!sel) return sel;
      const ids = new Set(pilotTrials.map((t) => t.id));
      const prolificIds = new Set(pilotTrials.map((t) => t.prolificId));
      if (sel.type === 'tutorial' || sel.type === 'review') {
        return prolificIds.has(sel.prolificId) ? sel : null;
      }
      return ids.has(sel.id) ? sel : null;
    });
  }, [pilotTrials]);

  const handleLoginSubmit = (e) => {
    e.preventDefault();
    if (passwordInput === ADMIN_PASSWORD) {
      try {
        sessionStorage.setItem(ADMIN_SESSION_KEY, '1');
      } catch {
        /* ignore */
      }
      setAuthed(true);
      setLoginError('');
      setPasswordInput('');
    } else {
      setLoginError('Incorrect password.');
    }
  };

  const handleLogout = () => {
    try {
      sessionStorage.removeItem(ADMIN_SESSION_KEY);
    } catch {
      /* ignore */
    }
    setAuthed(false);
    setSelected(null);
  };

  if (!authed) {
    return (
      <div className="admin-page admin-login-page">
        <div className="admin-login-card">
          <h1 className="admin-login-title">Admin Viewer</h1>
          <p className="admin-login-desc">Password required.</p>
          <form className="admin-login-form" onSubmit={handleLoginSubmit}>
            <label className="admin-login-label" htmlFor="admin-password">
              Password
            </label>
            <input
              id="admin-password"
              className="admin-login-input"
              type="password"
              autoComplete="current-password"
              value={passwordInput}
              onChange={(ev) => setPasswordInput(ev.target.value)}
            />
            {loginError ? (
              <p className="admin-login-error" role="alert">
                {loginError}
              </p>
            ) : null}
            <button type="submit" className="admin-login-submit">
              Continue
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (loading) return <div className="admin-loading">Loading...</div>;
  if (error) return <div className="admin-error">{error}</div>;

  // Group trials by prolificId (pilot_v3 only)
  const groupedTrials = {};
  pilotTrials.forEach((trial) => {
    const pid = trial.prolificId;
    if (!pid) return;
    const session = sessions[pid];
    if (!groupedTrials[pid]) {
      groupedTrials[pid] = [];
    }
    groupedTrials[pid].push({ ...trial, session });
  });

  const sortedProlificIds = Object.keys(groupedTrials).sort();

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Admin Viewer</h1>
        <p className="admin-cohort-note" style={{ margin: '0.25rem 0 0', fontSize: '0.9rem', color: '#555' }}>
          Showing sessions with <code>chartAssetFolder === pilot_v3</code> only.
        </p>
        <div className="admin-header-controls">
          <span className="admin-count">{pilotTrials.length} trials (pilot_v3)</span>
          <select 
            className="admin-group-select"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
          >
            <option value="prolificId">Group by Prolific ID</option>
            <option value="time">Sort by Time</option>
          </select>
          <button type="button" className="admin-logout-btn" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </div>

      <div className="admin-layout">
        {/* Left: trial list */}
        <div className="admin-list">
          {groupBy === 'prolificId' ? (
            // Grouped by Prolific ID
            sortedProlificIds.map((prolificId) => {
              const workerTrials = groupedTrials[prolificId];
              const review = reviews[prolificId];

              return (
                <div key={prolificId} className="admin-worker-group">
                  <div className="admin-worker-header">
                    <strong>{prolificId}</strong>
                  </div>
                  <div
                    key={`${prolificId}_tutorial`}
                    className={`admin-list-item ${selected?.id === `${prolificId}_tutorial` ? 'active' : ''}`}
                    onClick={() => setSelected({ id: `${prolificId}_tutorial`, type: 'tutorial', prolificId })}
                  >
                    <div className="admin-list-item-id">Tutorial</div>
                    <div className="admin-list-item-meta">Practice</div>
                  </div>
                  {workerTrials.map((trial) => (
                    <div
                      key={trial.id}
                      className={`admin-list-item ${selected?.id === trial.id ? 'active' : ''}`}
                      onClick={() => setSelected(trial)}
                    >
                      <div className="admin-list-item-id">{trial.trialId || trial.id}</div>
                      <div className="admin-list-item-meta">
                        Image #{trial.imageIndex}
                        {trial.generation?.status && (
                          <span className={`admin-status-badge admin-status-${trial.generation.status}`}>
                            {trial.generation.status}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  {review && (
                    <div
                      key={`${prolificId}_review`}
                      className={`admin-list-item ${selected?.id === `${prolificId}_review` ? 'active' : ''}`}
                      onClick={() => setSelected({ id: `${prolificId}_review`, type: 'review', prolificId, review })}
                    >
                      <div className="admin-list-item-id">Review</div>
                      <div className="admin-list-item-meta">
                        {review.submittedAt?.toDate ? review.submittedAt.toDate().toLocaleString() : '—'}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            // Sorted by time
            pilotTrials.map((trial) => {
              const pid = trial.prolificId;
              const session = pid ? sessions[pid] : null;
              return (
                <div
                  key={trial.id}
                  className={`admin-list-item ${selected?.id === trial.id ? 'active' : ''}`}
                  onClick={() => setSelected({ ...trial, session })}
                >
                  <div className="admin-list-item-id">
                    {pid || '(no id)'} - {trial.trialId || trial.id}
                  </div>
                  <div className="admin-list-item-meta">
                    Image #{trial.imageIndex} &nbsp;·&nbsp;
                    {trial.submittedAt?.toDate
                      ? trial.submittedAt.toDate().toLocaleString()
                      : '—'}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right: detail */}
        <div className="admin-detail">
          {!selected ? (
            <div className="admin-placeholder">← Select a trial, tutorial, or review to view details</div>
          ) : selected.type === 'tutorial' ? (
            <TutorialDetail prolificId={selected.prolificId} />
          ) : selected.type === 'review' ? (
            <>
              <h2 className="admin-detail-title">
                {selected.prolificId} - Review
              </h2>

              {/* Review Results */}
              <section className="admin-section">
                <h3>Review Responses</h3>
                <table className="admin-table">
                  <tbody>
                    {Object.entries(selected.review.responses || {})
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([key, value]) => (
                        <tr key={key}>
                          <td className="admin-table-key">{key}</td>
                          <td>{String(value)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {selected.review.submittedAt && (
                  <p style={{marginTop: '0.5rem', fontSize: '0.85rem', color: '#666'}}>
                    Submitted: {selected.review.submittedAt.toDate?.().toLocaleString() || '—'}
                  </p>
                )}
              </section>

              {/* Trials included in review */}
              <section className="admin-section">
                <h3>Reviewed Trials</h3>
                <p>{selected.review.trials?.join(', ') || 'No trial data'}</p>
              </section>
            </>
          ) : (
            <>
              <h2 className="admin-detail-title">
                {selected.prolificId} - {selected.trialId || selected.id}
              </h2>

              {/* Original | Details & Gen Status (row 1), generated images (row 2) */}
              <section className="admin-section">
                <div className="admin-trial-visual-grid">
                  <div className="admin-gen-image-container">
                    <h4>Original Worker Drawing</h4>
                    <WorkerDrawingImage
                      key={`${selected.prolificId}_${selected.trialId}`}
                      annotation={selected.annotation}
                    />
                  </div>
                  <div className="admin-gen-image-container">
                    <h4>Details &amp; Gen Status</h4>
                    {selected.generation ? (
                      <div className="admin-generation-info admin-generation-info--panel">
                        <div className="admin-gen-row">
                          <span className="admin-gen-label">Status:</span>
                          <span className={`admin-status-badge admin-status-${selected.generation.status}`}>
                            {selected.generation.status}
                          </span>
                        </div>
                        {selected.generation.startedAt && (
                          <div className="admin-gen-row">
                            <span className="admin-gen-label">Started:</span>
                            <span>{selected.generation.startedAt.toDate?.().toLocaleString() || '—'}</span>
                          </div>
                        )}
                        {selected.generation.completedAt && (
                          <div className="admin-gen-row">
                            <span className="admin-gen-label">Completed:</span>
                            <span>{selected.generation.completedAt.toDate?.().toLocaleString() || '—'}</span>
                          </div>
                        )}
                        {selected.generation.errorMessage && (
                          <div className="admin-gen-row admin-gen-error">
                            <span className="admin-gen-label">Error:</span>
                            <span>{selected.generation.errorMessage}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="admin-empty">No generation data yet</p>
                    )}
                    <div className="admin-details-text-panel">
                    {(() => {
                      const imageIndex = selected.imageIndex;
                      const chart = chartCaptions.find((c) => c.id === imageIndex);
                      const captionText =
                        typeof chart?.captions === 'string' && chart.captions.trim()
                          ? chart.captions.trim()
                          : 'No caption available';
                      const details = {
                        caption: captionText,
                        ...(selected.responses || {})
                      };
                      return Object.keys(details).length > 0 ? (
                        <table className="admin-table admin-details-in-panel">
                          <tbody>
                            {Object.entries(details)
                              .sort(([a], [b]) => a.localeCompare(b))
                              .map(([k, v]) => (
                                <tr key={k}>
                                  <td className="admin-table-key">{k}</td>
                                  <td>{String(v)}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      ) : (
                        <p className="admin-empty">No details.</p>
                      );
                    })()}
                    </div>
                  </div>
                  {selected.generation?.status === 'completed' && (
                    <>
                  <div className="admin-gen-image-container">
                    <h4>Experimental (Gemini)</h4>
                      <img
                        src={selected.generation.imgExp}
                        alt="Gemini experimental review image"
                        className="admin-annotation-img"
                      />
                  </div>
                    </>
                  )}
                </div>
              </section>

              <section className="admin-section">
                <h3>Participant review (this trial)</h3>
                <p className="admin-section-hint">
                  Columns: <code>v_exp</code> (Gemini) vs <code>v_base</code> (baseline). Rows follow{' '}
                  <code>questions.json</code> (each Likert + its <code>*_reason</code> text).
                </p>
                <TrialGenerationReviewAnswers
                  review={reviews[selected.prolificId]}
                  trialId={selected.trialId}
                />
              </section>

              {/* Stats */}
              <section className="admin-section">
                <h3>Stats</h3>
                <table className="admin-table">
                  <tbody>
                    <tr><td className="admin-table-key">Prolific ID</td><td>{selected.prolificId}</td></tr>
                    <tr><td className="admin-table-key">Image Index</td><td>{selected.imageIndex}</td></tr>
                    <tr><td className="admin-table-key">Stroke Count</td><td>{selected.strokeCount ?? '—'}</td></tr>
                    <tr><td className="admin-table-key">Duration</td><td>{selected.timing?.durationMs ? `${(selected.timing.durationMs / 1000).toFixed(1)}s` : '—'}</td></tr>
                    <tr><td className="admin-table-key">Submitted At</td><td>{selected.submittedAt?.toDate ? selected.submittedAt.toDate().toLocaleString() : '—'}</td></tr>
                  </tbody>
                </table>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
