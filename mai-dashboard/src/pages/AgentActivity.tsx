import { useEffect, useState } from 'react';
import type { AgentStatus } from '../types.js';
import { fetchAgents } from '../api.js';

function stateClass(state: string): string {
  if (state === 'IDLE') return 'state-idle';
  if (state === 'WORKING') return 'state-working';
  if (state === 'GRACEFUL_SHUTDOWN') return 'state-graceful';
  if (state === 'HARD_PAUSE') return 'state-hard';
  return '';
}

function BudgetBar({ pct }: { pct: number }) {
  const cls = 'budget-fill' + (pct >= 100 ? ' danger' : pct >= 90 ? ' warn' : '');
  return (
    <span className="budget-bar" title={`${pct.toFixed(1)}%`}>
      <span className={cls} style={{ width: `${Math.min(pct, 100)}%` }} />
    </span>
  );
}

export default function AgentActivity() {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    try {
      setAgents(await fetchAgents());
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => clearInterval(timer);
  }, []);

  if (loading) return <div className="loading">Loading…</div>;
  if (error) return <div className="page"><div className="error-msg">{error}</div></div>;

  return (
    <div className="page">
      <h1 className="page-title">Agent Activity</h1>
      {agents.length === 0
        ? <div className="empty">No agents configured.</div>
        : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="agents-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Model</th>
                  <th>State</th>
                  <th>Budget used</th>
                  <th>Active tasks</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.id}>
                    <td><strong>{a.id}</strong></td>
                    <td style={{ color: 'var(--muted)' }}>{a.model}</td>
                    <td><span className={stateClass(a.state)}>{a.state ?? '—'}</span></td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <BudgetBar pct={a.pct ?? 0} />
                        <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                          ${(a.spent_usd ?? 0).toFixed(2)} / ${(a.daily_usd ?? 0).toFixed(2)}
                        </span>
                      </div>
                    </td>
                    <td>{a.active_tasks ?? 0}</td>
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
