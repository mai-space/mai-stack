import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { Task, TaskStatus } from '../types.js';
import { fetchProjectTasks, bulkCloseBlocked } from '../api.js';
import { useWsEvents } from '../ws.js';
import TaskCard from '../components/TaskCard.js';

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'OPEN', label: 'Open' },
  { status: 'IN_PROGRESS', label: 'In Progress' },
  { status: 'BLOCKED', label: 'Blocked' },
  { status: 'DONE', label: 'Done' },
];

export default function ProjectKanban() {
  const { id } = useParams<{ id: string }>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [bulkClosing, setBulkClosing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setTasks(await fetchProjectTasks(id));
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  async function handleBulkClose() {
    if (!id) return;
    setBulkClosing(true);
    try {
      await bulkCloseBlocked(id);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBulkClosing(false);
    }
  }

  useEffect(() => { void load(); }, [load]);

  useWsEvents(useCallback((event) => {
    if (!event.channel.startsWith('task.')) return;
    const p = event.payload as { project_id?: string };
    if (p.project_id && p.project_id !== id) return;
    void load();
  }, [load, id]));

  if (loading) return <div className="loading">Loading…</div>;
  if (error) return <div className="page"><div className="error-msg">{error}</div></div>;

  const byStatus = (status: TaskStatus) => tasks.filter(t => t.status === status);

  return (
    <div className="page">
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link to="/" style={{ color: 'var(--muted)', fontSize: 14 }}>← Projects</Link>
        <span>{id}</span>
        <Link to={`/graph/${id}`} style={{ color: 'var(--muted)', fontSize: 13, marginLeft: 8 }}>View Graph →</Link>
      </h1>
      <div className="kanban">
        {COLUMNS.map(({ status, label }) => {
          const col = byStatus(status);
          return (
            <div key={status} className="column">
              <div className="column-header">
                <span>{label}</span>
                {status === 'BLOCKED' && col.some(t => t.blocker_type && t.blocker_type !== 'SUBTASK') ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>{col.length}</span>
                    <button
                      className="btn-muted"
                      style={{ fontSize: 10, padding: '2px 8px' }}
                      disabled={bulkClosing}
                      onClick={() => void handleBulkClose()}
                      title="Close all non-SUBTASK blocked tasks"
                    >
                      {bulkClosing ? '…' : 'Close all'}
                    </button>
                  </div>
                ) : (
                  <span>{col.length}</span>
                )}
              </div>
              <div className="column-body">
                {col.length === 0
                  ? <div className="empty" style={{ padding: '12px 0' }}>—</div>
                  : col.map(t => <TaskCard key={t.id} task={t} />)
                }
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
