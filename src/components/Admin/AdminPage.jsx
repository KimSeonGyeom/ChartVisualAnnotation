import { useState, useEffect } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../services/firebase';
import './AdminPage.css';

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
  const [trials, setTrials] = useState([]);
  const [sessions, setSessions] = useState({});
  const [sets, setSets] = useState({});
  const [reviews, setReviews] = useState({});
  const [suneungData, setSuneungData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [groupBy, setGroupBy] = useState('prolificId'); // 'prolificId' or 'time'

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch trials
        const trialsQuery = query(collection(db, 'trials'), orderBy('submittedAt', 'desc'));
        const trialsSnapshot = await getDocs(trialsQuery);
        const trialsData = trialsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        
        // Fetch sessions to get prolificId and other metadata
        const sessionsQuery = query(collection(db, 'sessions'));
        const sessionsSnapshot = await getDocs(sessionsQuery);
        const sessionsMap = {};
        sessionsSnapshot.docs.forEach(d => {
          sessionsMap[d.id] = d.data();
        });
        
        // Fetch sets to get stimulus captions
        const setsQuery = query(collection(db, 'sets'));
        const setsSnapshot = await getDocs(setsQuery);
        const setsMap = {};
        setsSnapshot.docs.forEach(d => {
          setsMap[d.id] = d.data();
        });
        
        // Fetch reviews
        const reviewsQuery = query(collection(db, 'reviews'));
        const reviewsSnapshot = await getDocs(reviewsQuery);
        const reviewsMap = {};
        reviewsSnapshot.docs.forEach(d => {
          reviewsMap[d.data().sessionId] = d.data();
        });
        
        // Fetch suneung caption data
        const suneungResponse = await fetch('/suneung_caption.json');
        const suneungJson = await suneungResponse.json();
        
        setTrials(trialsData);
        setSessions(sessionsMap);
        setSets(setsMap);
        setReviews(reviewsMap);
        setSuneungData(suneungJson);
      } catch (err) {
        setError('Failed to load data: ' + err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) return <div className="admin-loading">Loading...</div>;
  if (error) return <div className="admin-error">{error}</div>;

  // Group trials by prolificId
  const groupedTrials = {};
  trials.forEach(trial => {
    const session = sessions[trial.sessionId];
    const prolificId = session?.prolificId || 'unknown';
    if (!groupedTrials[prolificId]) {
      groupedTrials[prolificId] = [];
    }
    groupedTrials[prolificId].push({ ...trial, prolificId, session });
  });

  const sortedProlificIds = Object.keys(groupedTrials).sort();

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Admin Viewer</h1>
        <div className="admin-header-controls">
          <span className="admin-count">{trials.length} trials</span>
          <select 
            className="admin-group-select"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
          >
            <option value="prolificId">Group by Prolific ID</option>
            <option value="time">Sort by Time</option>
          </select>
        </div>
      </div>

      <div className="admin-layout">
        {/* Left: trial list */}
        <div className="admin-list">
          {groupBy === 'prolificId' ? (
            // Grouped by Prolific ID
            sortedProlificIds.map(prolificId => {
              const workerTrials = groupedTrials[prolificId];
              const sessionId = workerTrials[0]?.sessionId;
              const review = reviews[sessionId];
              
              return (
                <div key={prolificId} className="admin-worker-group">
                  <div className="admin-worker-header">
                    <strong>{prolificId}</strong>
                    <span className="admin-worker-count">
                      ({workerTrials.length} trials)
                    </span>
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
                  {workerTrials.map(trial => (
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
            trials.map(trial => {
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

              {/* Generation Status & Images */}
              <section className="admin-section">
                <h3>Generation Status</h3>
                {selected.generation ? (
                  <>
                    <div className="admin-generation-info">
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

                    {/* Generated Images */}
                    {selected.generation.status === 'completed' && (
                      <div className="admin-generated-images">
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
                      </div>
                    )}
                  </>
                ) : (
                  <p className="admin-empty">No generation data yet</p>
                )}
              </section>

              {/* Original Annotation Image */}
              <section className="admin-section">
                <h3>Original Worker Drawing</h3>
                {(selected.annotation?.imageUrl || selected.annotation?.imageData) ? (
                  <img
                    className="admin-annotation-img"
                    src={selected.annotation.imageUrl || selected.annotation.imageData}
                    alt="annotation"
                  />
                ) : (
                  <p className="admin-empty">No image saved.</p>
                )}
              </section>

              {/* Details */}
              <section className="admin-section">
                <h3>Details</h3>
                {(() => {
                  const setId = selected.session?.assignedSetId;
                  const imageIndex = selected.imageIndex;
                  const setData = sets[setId];
                  const captionIdx = setData?.captionIndex ?? 0;
                  
                  // Find caption from suneungData
                  const chart = suneungData.find(c => c.id === imageIndex);
                  const caption = chart?.captions?.[captionIdx] || 'No caption available';
                  
                  const details = {
                    caption: caption,
                    ...(selected.responses || {})
                  };
                  
                  return Object.keys(details).length > 0 ? (
                    <table className="admin-table">
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
