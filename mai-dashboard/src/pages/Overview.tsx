import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import type { ProjectSummary } from '../types.js';
import { fetchOverview } from '../api.js';
import { useWsEvents } from '../ws.js';

export default function Overview() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setProjects(await fetchOverview());
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useWsEvents(useCallback((event) => {
    if (event.channel.startsWith('task.')) void load();
  }, [load]));

  if (loading) return <div className="loading">Loading…</div>;
  if (error) return <div className="page"><div className="error-msg">{error}</div></div>;

  return (
    <div className="page">
      <h1 className="page-title">Projects</h1>
      {projects.length === 0 && <div className="empty">No projects registered yet.</div>}
      <div className="grid">
        {projects.map((p) => (
          <div key={p.id} className="card">
            <div className="card-title">
              <Link to={`/projects/${p.id}`}>{p.name}</Link>
            </div>
            <div className="stat-row">
              <div className="stat">
                <div className="stat-value">{p.open}</div>
                <div className="stat-label">Open</div>
              </div>
              <div className="stat">
                <div className="stat-value" style={{ color: 'var(--primary)' }}>{p.inProgress}</div>
                <div className="stat-label">Active</div>
              </div>
              <div className="stat">
                <div className="stat-value" style={{ color: 'var(--warning)' }}>{p.blocked}</div>
                <div className="stat-label">Blocked</div>
              </div>
              <div className="stat">
                <div className="stat-value" style={{ color: 'var(--success)' }}>{p.done}</div>
                <div className="stat-label">Done</div>
              </div>
            </div>
            {p.escalations > 0 && (
              <Link to="/escalations" style={{ color: 'var(--danger)', fontSize: 13 }}>
                ⚠ {p.escalations} escalation{p.escalations !== 1 ? 's' : ''} waiting
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
