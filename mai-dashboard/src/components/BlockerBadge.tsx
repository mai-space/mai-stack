import type { BlockerType } from '../types.js';

interface Props {
  type: BlockerType;
  severity?: string;
}

export default function BlockerBadge({ type, severity }: Props) {
  let cls = 'badge ';
  if (type === 'DECISION') cls += 'badge-decision';
  else if (type === 'CLARIFICATION') cls += 'badge-clarification';
  else if (type === 'RISK') {
    if (severity === 'critical') cls += 'badge-risk-critical';
    else if (severity === 'high') cls += 'badge-risk-high';
    else if (severity === 'medium') cls += 'badge-risk-medium';
    else cls += 'badge-risk-low';
  }
  else if (type === 'SUBTASK') cls += 'badge-subtask';
  else if (type === 'CAPABILITY') cls += 'badge-capability';
  else cls += 'badge-subtask';

  const label = type === 'RISK' && severity ? `${type} (${severity})` : type;
  return <span className={cls}>{label}</span>;
}
