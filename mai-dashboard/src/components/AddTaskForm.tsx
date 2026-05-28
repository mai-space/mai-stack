import { useState } from 'react';
import { createTask } from '../api.js';

interface Props {
  projectId: string;
  onCreated: () => void;
}

export default function AddTaskForm({ projectId, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function reset() {
    setTitle('');
    setDescription('');
    setPriority('0');
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await createTask(projectId, {
        title: title.trim(),
        description: description.trim() || undefined,
        priority: Number.parseInt(priority, 10) || 0,
      });
      reset();
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        className="btn-muted add-task-toggle"
        onClick={() => setOpen(true)}
      >
        + Add Task
      </button>
    );
  }

  return (
    <form className="add-task-form" onSubmit={(e) => void handleSubmit(e)}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Task title"
        required
        autoFocus
      />
      <textarea
        rows={2}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
      />
      <div className="add-task-row">
        <label className="form-label-inline">
          Priority
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            style={{ width: 64 }}
          />
        </label>
        <div className="add-task-actions">
          <button
            type="button"
            className="btn-muted"
            onClick={() => { reset(); setOpen(false); }}
          >
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !title.trim()}>
            {busy ? '…' : 'Add'}
          </button>
        </div>
      </div>
      {error && <div className="error-msg" style={{ marginTop: 6 }}>{error}</div>}
    </form>
  );
}
