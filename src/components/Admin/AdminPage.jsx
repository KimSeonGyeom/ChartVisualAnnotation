import { useState, useEffect } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '../../services/firebase';
import './AdminPage.css';

export default function AdminPage() {
  const [trials, setTrials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    const fetchTrials = async () => {
      try {
        const q = query(collection(db, 'trials'), orderBy('submittedAt', 'desc'));
        const snapshot = await getDocs(q);
        const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        setTrials(data);
      } catch (err) {
        setError('Failed to load data: ' + err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchTrials();
  }, []);

  if (loading) return <div className="admin-loading">Loading...</div>;
  if (error) return <div className="admin-error">{error}</div>;

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Admin Viewer</h1>
        <span className="admin-count">{trials.length} trials</span>
      </div>

      <div className="admin-layout">
        {/* Left: trial list */}
        <div className="admin-list">
          {trials.map(trial => (
            <div
              key={trial.id}
              className={`admin-list-item ${selected?.id === trial.id ? 'active' : ''}`}
              onClick={() => setSelected(trial)}
            >
              <div className="admin-list-item-id">{trial.id}</div>
              <div className="admin-list-item-meta">
                Image #{trial.imageIndex} &nbsp;·&nbsp;
                {trial.submittedAt?.toDate
                  ? trial.submittedAt.toDate().toLocaleString()
                  : '—'}
              </div>
            </div>
          ))}
        </div>

        {/* Right: detail */}
        <div className="admin-detail">
          {!selected ? (
            <div className="admin-placeholder">← Select a trial to view details</div>
          ) : (
            <>
              <h2 className="admin-detail-title">{selected.id}</h2>

              {/* Annotation Image */}
              <section className="admin-section">
                <h3>Annotation Image</h3>
                {selected.annotation?.imageData ? (
                  <img
                    className="admin-annotation-img"
                    src={selected.annotation.imageData}
                    alt="annotation"
                  />
                ) : (
                  <p className="admin-empty">No image saved.</p>
                )}
              </section>

              {/* Survey Responses */}
              <section className="admin-section">
                <h3>Survey Responses</h3>
                {selected.responses && Object.keys(selected.responses).length > 0 ? (
                  <table className="admin-table">
                    <tbody>
                      {Object.entries(selected.responses).map(([k, v]) => (
                        <tr key={k}>
                          <td className="admin-table-key">{k}</td>
                          <td>{String(v)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="admin-empty">No responses.</p>
                )}
              </section>

              {/* Stats */}
              <section className="admin-section">
                <h3>Stats</h3>
                <table className="admin-table">
                  <tbody>
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
