import { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../services/firebase';
import './AdminPage.css';

/** Shown as synthetic "Tutorial" row; hide duplicate trial rows from Firestore. */
const TUTORIAL_PRACTICE_TRIAL_ID = 'tutorial_practice';

const ADMIN_PASSWORD = 'AELCVA';
const ADMIN_SESSION_KEY = 'cva_admin_ok';

function readAdminAuthed() {
  try {
    return sessionStorage.getItem(ADMIN_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

/** Submitted At (UTC) cohort boundaries for admin tabs */
const APR_10_2026_UTC_MS = Date.UTC(2026, 3, 10);
const MAY_2_2026_UTC_MS = Date.UTC(2026, 4, 2);

function trialSubmittedAtMs(trial) {
  const ts = trial?.submittedAt;
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate().getTime();
  if (typeof ts.seconds === 'number') {
    return ts.seconds * 1000 + Math.floor((ts.nanoseconds || 0) / 1e6);
  }
  return null;
}

/** @returns {'pilot_v1' | 'v2' | 'v3' | 'undated'} */
function cohortForTrial(trial) {
  const ms = trialSubmittedAtMs(trial);
  if (ms == null) return 'undated';
  if (ms < APR_10_2026_UTC_MS) return 'pilot_v1';
  if (ms < MAY_2_2026_UTC_MS) return 'v2';
  return 'v3';
}

function isHttpUrl(s) {
  return typeof s === 'string' && /^https?:\/\//i.test(s.trim());
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

function TutorialDetail({ sessionId, prolificId }) {
  const [tutorialImageUrl, setTutorialImageUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchTutorialImage = async () => {
      try {
        const storageRef = ref(storage, `tutorials/${sessionId}_tutorial.jpg`);
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
  }, [sessionId]);

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
            <tr><td className="admin-table-key">Session</td><td>{sessionId}</td></tr>
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
  const [suneungData, setSuneungData] = useState([]);
  const [loading, setLoading] = useState(readAdminAuthed);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [groupBy, setGroupBy] = useState('prolificId'); // 'prolificId' or 'time'
  const [studyCohort, setStudyCohort] = useState('v2');

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
          reviewsMap[d.data().sessionId] = d.data();
        });

        const suneungResponse = await fetch('/suneung_caption.json');
        const suneungJson = await suneungResponse.json();

        if (!cancelled) {
          setTrials(trialsData);
          setSessions(sessionsMap);
          setSets(setsMap);
          setReviews(reviewsMap);
          setSuneungData(suneungJson);
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

  const cohortCounts = useMemo(() => {
    const c = { pilot_v1: 0, v2: 0, v3: 0, undated: 0 };
    trialsSansTutorial.forEach(t => {
      c[cohortForTrial(t)] += 1;
    });
    return c;
  }, [trialsSansTutorial]);

  const tabTrials = useMemo(
    () => trialsSansTutorial.filter(t => cohortForTrial(t) === studyCohort),
    [trialsSansTutorial, studyCohort]
  );

  useEffect(() => {
    setSelected(sel => {
      if (!sel) return sel;
      const filtered = trialsSansTutorial.filter(t => cohortForTrial(t) === studyCohort);
      const ids = new Set(filtered.map(t => t.id));
      const sessionIds = new Set(filtered.map(t => t.sessionId));
      if (sel.type === 'tutorial' || sel.type === 'review') {
        return sessionIds.has(sel.sessionId) ? sel : null;
      }
      return ids.has(sel.id) ? sel : null;
    });
  }, [studyCohort, trialsSansTutorial]);

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

  // Group trials by prolificId (current cohort tab only)
  const groupedTrials = {};
  tabTrials.forEach(trial => {
    const session = sessions[trial.sessionId];
    const prolificId = session?.prolificId || 'unknown';
    if (!groupedTrials[prolificId]) {
      groupedTrials[prolificId] = [];
    }
    groupedTrials[prolificId].push({ ...trial, prolificId, session });
  });

  const sortedProlificIds = Object.keys(groupedTrials).sort();

  const cohortTabs = [
    { key: 'pilot_v1', label: 'Pilot Study v1', hint: 'before Apr 10, 2026 UTC' },
    { key: 'v2', label: 'Pilot Study v2', hint: 'Apr 10 – May 1, 2026 UTC' },
    { key: 'v3', label: 'Pilot Study v3', hint: 'from May 2, 2026 UTC' },
  ];

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Admin Viewer</h1>
        <div className="admin-header-controls">
          <span className="admin-count">{tabTrials.length} trials</span>
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

      <div className="admin-tabs" role="tablist" aria-label="Study cohort">
        {cohortTabs.map(({ key, label, hint }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={studyCohort === key}
            className={`admin-tab ${studyCohort === key ? 'active' : ''}`}
            onClick={() => setStudyCohort(key)}
          >
            <span className="admin-tab-label">{label}</span>
            <span className="admin-tab-hint">{hint}</span>
            <span className="admin-tab-count">{cohortCounts[key]}</span>
          </button>
        ))}
        {cohortCounts.undated > 0 && (
          <button
            type="button"
            role="tab"
            aria-selected={studyCohort === 'undated'}
            className={`admin-tab ${studyCohort === 'undated' ? 'active' : ''}`}
            onClick={() => setStudyCohort('undated')}
          >
            <span className="admin-tab-label">Undated</span>
            <span className="admin-tab-hint">no Submitted At</span>
            <span className="admin-tab-count">{cohortCounts.undated}</span>
          </button>
        )}
      </div>

      <div className="admin-layout">
        {/* Left: trial list */}
        <div className="admin-list">
          {groupBy === 'prolificId' ? (
            // Grouped by Prolific ID
            sortedProlificIds.map(prolificId => {
              const workerTrials = groupedTrials[prolificId];
              const workerTrialsListed = workerTrials;
              const sessionId = workerTrials[0]?.sessionId;
              const review = reviews[sessionId];
              
              return (
                <div key={prolificId} className="admin-worker-group">
                  <div className="admin-worker-header">
                    <strong>{prolificId}</strong>
                  </div>
                  {/* Tutorial */}
                  {sessionId && (
                    <div
                      key={`${sessionId}_tutorial`}
                      className={`admin-list-item ${selected?.id === `${sessionId}_tutorial` ? 'active' : ''}`}
                      onClick={() => setSelected({ id: `${sessionId}_tutorial`, type: 'tutorial', sessionId, prolificId })}
                    >
                      <div className="admin-list-item-id">Tutorial</div>
                      <div className="admin-list-item-meta">Practice</div>
                    </div>
                  )}
                  {workerTrialsListed.map(trial => (
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
                      key={`${sessionId}_review`}
                      className={`admin-list-item ${selected?.id === `${sessionId}_review` ? 'active' : ''}`}
                      onClick={() => setSelected({ id: `${sessionId}_review`, type: 'review', sessionId, prolificId, review })}
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
            tabTrials.map(trial => {
              const session = sessions[trial.sessionId];
              const prolificId = session?.prolificId || 'unknown';
              return (
                <div
                  key={trial.id}
                  className={`admin-list-item ${selected?.id === trial.id ? 'active' : ''}`}
                  onClick={() => setSelected({ ...trial, prolificId, session })}
                >
                  <div className="admin-list-item-id">
                    {prolificId} - {trial.trialId || trial.id}
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
            <TutorialDetail sessionId={selected.sessionId} prolificId={selected.prolificId} />
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
                      key={`${selected.sessionId}_${selected.trialId}`}
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
                      const setId = selected.session?.assignedSetId;
                      const imageIndex = selected.imageIndex;
                      const setData = sets[setId];
                      const captionIdx = setData?.captionIndex ?? 0;
                      const chart = suneungData.find(c => c.id === imageIndex);
                      const caption = chart?.captions?.[captionIdx] || 'No caption available';
                      const details = {
                        caption,
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
                        <h4>Version 1: Chart only</h4>
                        {selected.generation.reviewImageUrl1 ? (
                          <img
                            src={selected.generation.reviewImageUrl1}
                            alt="Generated annotation v1"
                            className="admin-annotation-img"
                          />
                        ) : (
                          <p className="admin-empty">No image URL</p>
                        )}
                      </div>
                      <div className="admin-gen-image-container">
                        <h4>Version 2: Chart + Drawing</h4>
                        {selected.generation.reviewImageUrl2 ? (
                          <img
                            src={selected.generation.reviewImageUrl2}
                            alt="Generated annotation v2"
                            className="admin-annotation-img"
                          />
                        ) : (
                          <p className="admin-empty">No image URL</p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </section>

              {/* Stats */}
              <section className="admin-section">
                <h3>Stats</h3>
                <table className="admin-table">
                  <tbody>
                    <tr><td className="admin-table-key">Prolific ID</td><td>{selected.prolificId}</td></tr>
                    <tr><td className="admin-table-key">Session</td><td>{selected.sessionId}</td></tr>
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
