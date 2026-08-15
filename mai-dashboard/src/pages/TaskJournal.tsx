import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { JournalEntry } from '../types.js';
import { fetchTaskJournal } from '../api.js';
import { useWsEvents } from '../ws.js';

function kindClass(kind: string): string {
  if (kind === 'error') return 'journal-kind-error';
  if (kind === 'gate_result') return 'journal-kind-gate';
  if (kind === 'run_complete') return 'journal-kind-complete';
  if (kind === 'agent_started') return 'journal-kind-started';
  return 'journal-kind-default';
}

function formatPayload(entry: JournalEntry): string {
  const payload = entry.payload;
  if (payload && typeof payload === 'object') {
    const p = payload as { text?: string; message?: string };
    if (typeof p.text === 'string') return p.text;
    if (typeof p.message === 'string') return p.message;
  }
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

export default function TaskJournal() {
  const { id } = useParams<{ id: string }>();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setEntries(await fetchTaskJournal(id));
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  useWsEvents(useCallback((event) => {
    if (event.channel !== `journal.${id}`) return;
    void load();
  }, [load, id]));

  if (loading) return <div className="loading">Loading…</div>;
  if (error) return <div className="page"><div className="error-msg">{error}</div></div>;

  return (
    <div className="page">
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link to="/" style={{ color: 'var(--muted)', fontSize: 14 }}>← Projects</Link>
        <span>Task #{id} — Journal</span>
      </h1>
      {entries.length === 0
        ? <div className="empty">No journal entries yet.</div>
        : (
          <div className="journal-list">
            {entries.map(e => (
              <div key={e.id} className={`journal-entry ${kindClass(e.kind)}`}>
                <div className="journal-entry-header">
                  <span className="journal-kind">{e.kind}</span>
                  {e.agent_id && <span className="journal-agent">@{e.agent_id}</span>}
                  <span className="journal-time">{new Date(e.created_at).toLocaleTimeString()}</span>
                </div>
                <pre className="journal-payload">{formatPayload(e)}</pre>
              </div>
            ))}
          </div>
        )
      }
    </div>
  );
}
