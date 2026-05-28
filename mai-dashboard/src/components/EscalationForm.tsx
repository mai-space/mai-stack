import { useState } from 'react';
import type { Escalation } from '../types.js';
import BlockerBadge from './BlockerBadge.js';
import { resolveDecision, resolveClarification, resolveRisk } from '../api.js';

interface Props {
  escalation: Escalation;
  onResolved: (taskId: string) => void;
}

export default function EscalationForm({ escalation, onResolved }: Props) {
  const [notes, setNotes] = useState('');
  const [clarificationText, setClarificationText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handle(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      onResolved(escalation.task_id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="escalation-item">
      <div className="escalation-header">
        <div>
          <div className="escalation-title">{escalation.task_title}</div>
          <div className="escalation-project">{escalation.project_name} · {escalation.task_id.slice(0, 8)}</div>
        </div>
        <BlockerBadge type={escalation.blocker_type} severity={escalation.severity} />
      </div>

      {escalation.blocker_type === 'DECISION' && (
        <>
          <div className="escalation-question">{escalation.question}</div>
          <div className="options-row">
            {(escalation.options ?? []).map((opt) => (
              <button
                key={opt}
                className="btn-primary"
                disabled={busy}
                onClick={() => handle(() => resolveDecision(escalation.task_id, opt))}
              >
                {opt}
              </button>
            ))}
          </div>
        </>
      )}

      {escalation.blocker_type === 'CLARIFICATION' && (
        <>
          <div className="escalation-question">{escalation.question}</div>
          <textarea
            rows={3}
            placeholder="Your response…"
            value={clarificationText}
            onChange={(e) => setClarificationText(e.target.value)}
          />
          <button
            className="btn-primary"
            disabled={busy || !clarificationText.trim()}
            onClick={() => handle(() => resolveClarification(escalation.task_id, clarificationText.trim()))}
          >
            Submit response
          </button>
        </>
      )}

      {escalation.blocker_type === 'RISK' && (
        <>
          <div className="escalation-question">{escalation.description}</div>
          <textarea
            rows={2}
            placeholder="Optional notes…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="options-row">
            <button
              className="btn-success"
              disabled={busy}
              onClick={() => handle(() => resolveRisk(escalation.task_id, true, notes || undefined))}
            >
              Approve
            </button>
            <button
              className="btn-danger"
              disabled={busy}
              onClick={() => handle(() => resolveRisk(escalation.task_id, false, notes || undefined))}
            >
              Reject
            </button>
          </div>
        </>
      )}

      {error && <div className="error-msg">{error}</div>}
    </div>
  );
}
