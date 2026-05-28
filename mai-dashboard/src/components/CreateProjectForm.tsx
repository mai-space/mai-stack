import { useState } from 'react';
import { createProject } from '../api.js';

interface Props {
  onCreated: () => void;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function CreateProjectForm({ onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [description, setDescription] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [workspaceTouched, setWorkspaceTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function handleNameChange(value: string) {
    setName(value);
    if (!idTouched) setId(slugify(value));
    if (!workspaceTouched) setWorkspacePath(value ? `/workspaces/${slugify(value)}` : '');
  }

  function reset() {
    setId('');
    setName('');
    setWorkspacePath('');
    setDescription('');
    setIdTouched(false);
    setWorkspaceTouched(false);
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await createProject({
        id: id.trim(),
        name: name.trim(),
        workspace_path: workspacePath.trim(),
        description: description.trim() || undefined,
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
      <button className="btn-primary" onClick={() => setOpen(true)}>
        New Project
      </button>
    );
  }

  return (
    <form className="form-card" onSubmit={(e) => void handleSubmit(e)}>
      <div className="form-card-header">
        <span className="form-card-title">Create Project</span>
        <button type="button" className="btn-muted" onClick={() => { reset(); setOpen(false); }}>
          Cancel
        </button>
      </div>

      <label className="form-label">
        Name
        <input
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="My Project"
          required
          autoFocus
        />
      </label>

      <label className="form-label">
        ID
        <input
          value={id}
          onChange={(e) => { setId(e.target.value); setIdTouched(true); }}
          placeholder="my-project"
          required
          pattern="[a-z0-9][a-z0-9-]*"
          title="Lowercase letters, numbers, and hyphens"
        />
      </label>

      <label className="form-label">
        Workspace Path
        <input
          value={workspacePath}
          onChange={(e) => { setWorkspacePath(e.target.value); setWorkspaceTouched(true); }}
          placeholder="/workspaces/my-project"
          required
        />
      </label>

      <label className="form-label">
        Description <span className="form-optional">(optional)</span>
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Short project description"
        />
      </label>

      {error && <div className="error-msg">{error}</div>}

      <button type="submit" className="btn-primary" disabled={busy || !id.trim() || !name.trim() || !workspacePath.trim()}>
        {busy ? 'Creating…' : 'Create Project'}
      </button>
    </form>
  );
}
