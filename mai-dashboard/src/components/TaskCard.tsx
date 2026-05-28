import { Link } from 'react-router-dom';
import type { Task } from '../types.js';
import BlockerBadge from './BlockerBadge.js';

interface Props {
  task: Task;
}

export default function TaskCard({ task }: Props) {
  let blocker: { severity?: string } = {};
  try { blocker = JSON.parse(task.blocker_payload); } catch { /* ignore */ }

  return (
    <div className="task-card">
      <div className="task-title">{task.title}</div>
      <div className="task-meta">
        {task.priority > 0 && <span className="task-priority">p{task.priority}</span>}
        {task.assigned_agent && <span className="task-agent">@{task.assigned_agent}</span>}
        {task.blocker_type && (
          <Link to="/escalations">
            <BlockerBadge type={task.blocker_type} severity={blocker.severity} />
          </Link>
        )}
      </div>
    </div>
  );
}
