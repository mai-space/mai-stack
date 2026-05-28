import { useEffect, useState, useCallback } from 'react';
import type { Escalation } from '../types.js';
import { fetchEscalations } from '../api.js';
import { useWsEvents } from '../ws.js';
import EscalationForm from '../components/EscalationForm.js';

export default function EscalationQueue() {
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setEscalations(await fetchEscalations());
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useWsEvents(useCallback((event) => {
    if (!event.channel.startsWith('task.')) return;
    const p = event.payload as { to?: string; from?: string; blocker_type?: string };
    const isEscalationChange =
      (p.to === 'BLOCKED' && ['DECISION', 'CLARIFICATION', 'RISK'].includes(p.blocker_type ?? '')) ||
      (p.from === 'BLOCKED');
    if (isEscalationChange) void load();
  }, [load]));

  function onResolved(taskId: string) {
    setEscalations(prev => prev.filter(e => e.task_id !== taskId));
  }

  if (loading) return <div className="loading">Loading…</div>;
  if (error) return <div className="page"><div className="error-msg">{error}</div></div>;

  return (
    <div className="page">
      <h1 className="page-title">Escalation Queue</h1>
      {escalations.length === 0
        ? <div className="empty">No escalations waiting — agents are unblocked.</div>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
            {escalations.map(e => (
              <EscalationForm key={e.task_id} escalation={e} onResolved={onResolved} />
            ))}
          </div>
        )
      }
    </div>
  );
}
