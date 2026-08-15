import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ActiveRun } from '../types.js';
import { fetchActiveRuns, killRun } from '../api.js';

export default function RunnerStatus() {
  const [runs, setRuns] = useState<ActiveRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [killing, setKilling] = useState<string | null>(null);

  async function load() {
    try {
      setRuns(await fetchActiveRuns());
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleKill(taskId: string) {
    setKilling(taskId);
    try {
      await killRun(taskId);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setKilling(null);
    }
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, []);

  if (loading) return <div className="loading">Loading…</div>;
  if (error) return <div className="page"><div className="error-msg">{error}</div></div>;

  return (
    <div className="page">
      <h1 className="page-title">Runner Status</h1>
      {runs.length === 0
        ? <div className="empty">No managed agent runs in progress.</div>
        : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="agents-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Project</th>
                  <th>Agent</th>
                  <th>Branch</th>
                  <th>Started</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {runs.map(r => (
                  <tr key={r.taskId}>
                    <td><Link to={`/tasks/${r.taskId}/journal`}>#{r.taskId}</Link></td>
                    <td>{r.projectId}</td>
                    <td>@{r.agentId}</td>
                    <td style={{ color: 'var(--muted)', fontSize: 12 }}>{r.branch || '—'}</td>
                    <td style={{ color: 'var(--muted)', fontSize: 12 }}>{new Date(r.startedAt).toLocaleTimeString()}</td>
                    <td>
                      <button
                        className="btn-danger"
                        disabled={killing === r.taskId}
                        onClick={() => void handleKill(r.taskId)}
                        style={{ fontSize: 11 }}
                      >
                        {killing === r.taskId ? 'Killing…' : 'Kill'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
    </div>
  );
}
