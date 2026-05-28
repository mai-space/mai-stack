import { readFile } from 'fs/promises';

const REGISTRY_URL = process.env.REGISTRY_URL ?? 'http://mai-registry:3459';
const PROJECT_MCP_URL = process.env.PROJECT_MCP_URL ?? 'http://mai-project-mcp:3456';
const CODE_MCP_URL = process.env.CODE_MCP_URL ?? 'http://mai-code-mcp:3457';
const MEMORY_MCP_URL = process.env.MEMORY_MCP_URL ?? 'http://mai-memory-mcp:3458';

interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  parent_task_id: string | null;
  blocker_type: string | null;
  blocker_payload: string;
  blocker_resolved_at: string | null;
}

interface Project {
  id: string;
  name: string;
  system_prompt_override: string | null;
  agents_md_path: string | null;
  reindex_threshold_minutes: number;
}

interface CodeChunk {
  file_path: string;
  line_start: number;
  content: string;
  similarity_score: number;
}

interface Memory {
  id: string;
  key: string;
  value: string;
  created_at: string;
}

async function readAgentsMd(agentsMdPath: string): Promise<string> {
  try {
    return await readFile(agentsMdPath, 'utf8');
  } catch {
    return '';
  }
}

async function searchCode(projectId: string, query: string, topK = 5): Promise<CodeChunk[]> {
  try {
    const res = await fetch(`${CODE_MCP_URL}/search/${projectId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, top_k: topK }),
    });
    if (!res.ok) return [];
    return await res.json() as CodeChunk[];
  } catch {
    return [];
  }
}

interface ProjectState {
  open: number;
  blocked: number;
  inProgress: number;
  recentDone: string[];
}

async function fetchProjectState(projectId: string): Promise<ProjectState> {
  try {
    const res = await fetch(`${PROJECT_MCP_URL}/projects/${projectId}/tasks`);
    if (!res.ok) return { open: 0, blocked: 0, inProgress: 0, recentDone: [] };
    const tasks = await res.json() as Task[];
    const open = tasks.filter(t => t.status === 'OPEN').length;
    const blocked = tasks.filter(t => t.status === 'BLOCKED').length;
    const inProgress = tasks.filter(t => t.status === 'IN_PROGRESS').length;
    const recentDone = tasks.filter(t => t.status === 'DONE').slice(0, 3).map(t => t.title);
    return { open, blocked, inProgress, recentDone };
  } catch {
    return { open: 0, blocked: 0, inProgress: 0, recentDone: [] };
  }
}

interface TaskDeps {
  parentTitle: string | null;
  childTitles: string[];
}

async function fetchTaskDeps(task: Task): Promise<TaskDeps> {
  let parentTitle: string | null = null;
  const childTitles: string[] = [];

  if (task.parent_task_id) {
    try {
      const res = await fetch(`${PROJECT_MCP_URL}/tasks/${task.parent_task_id}`);
      if (res.ok) {
        const parent = await res.json() as Task;
        parentTitle = `#${parent.id} — ${parent.title} [${parent.status}]`;
      }
    } catch { /* ignore */ }
  }

  try {
    const res = await fetch(`${PROJECT_MCP_URL}/projects/${task.project_id}/tasks`);
    if (res.ok) {
      const all = await res.json() as Task[];
      for (const t of all) {
        if (t.parent_task_id === task.id && t.status !== 'DONE') {
          childTitles.push(`#${t.id} — ${t.title} [${t.status}]`);
        }
      }
    }
  } catch { /* ignore */ }

  return { parentTitle, childTitles };
}

async function fetchMemories(projectId: string, query: string): Promise<Memory[]> {
  try {
    const res = await fetch(`${MEMORY_MCP_URL}/projects/${projectId}/memories/recall?q=${encodeURIComponent(query)}&limit=5`);
    if (!res.ok) return [];
    return await res.json() as Memory[];
  } catch {
    return [];
  }
}

export async function assembleManifest(task: Task, agentId: string, staleWarning: string | null): Promise<string> {
  const projectRes = await fetch(`${REGISTRY_URL}/projects/${task.project_id}`).catch(() => null);
  const project: Project | null = projectRes?.ok ? await projectRes.json() as Project : null;

  const [codeResult, stateResult, depsResult, memoriesResult, agentsMdResult] = await Promise.allSettled([
    searchCode(task.project_id, task.title),
    fetchProjectState(task.project_id),
    fetchTaskDeps(task),
    fetchMemories(task.project_id, task.title),
    project?.agents_md_path ? readAgentsMd(project.agents_md_path) : Promise.resolve(''),
  ]);

  const chunks = codeResult.status === 'fulfilled' ? codeResult.value : [];
  const state = stateResult.status === 'fulfilled' ? stateResult.value : null;
  const deps = depsResult.status === 'fulfilled' ? depsResult.value : null;
  const memories = memoriesResult.status === 'fulfilled' ? memoriesResult.value : [];
  const agentsMd = agentsMdResult.status === 'fulfilled' ? agentsMdResult.value : '';

  const lines: string[] = [];

  lines.push(`TASK: #${task.id} — ${task.title}`);
  lines.push(`PROJECT: ${task.project_id}`);
  lines.push(`AGENT: ${agentId}`);
  lines.push('');

  lines.push('═══ PROJECT CONTEXT ════════════════════════════════════════════');
  const projectContext = [project?.system_prompt_override?.trim(), agentsMd?.trim()].filter(Boolean).join('\n');
  lines.push(projectContext || '(no project context configured)');
  lines.push('');

  lines.push('═══ RELEVANT CODE ══════════════════════════════════════════════');
  if (staleWarning) lines.push(staleWarning);
  if (chunks.length === 0) {
    lines.push('(no indexed code chunks — run reindex_project to populate)');
  } else {
    for (const chunk of chunks) {
      lines.push(`→ ${chunk.file_path.padEnd(40)} similarity ${chunk.similarity_score.toFixed(2)}`);
      lines.push(`  ${chunk.content.slice(0, 200).replace(/\n/g, ' ')}`);
    }
  }
  lines.push('');

  lines.push('═══ PROJECT STATE ══════════════════════════════════════════════');
  if (state) {
    lines.push(`Open: ${state.open}  |  Blocked: ${state.blocked}  |  In progress: ${state.inProgress}`);
    if (state.recentDone.length > 0) {
      lines.push(`Recently completed: ${state.recentDone.map(t => `"${t}"`).join(', ')}`);
    }
  } else {
    lines.push('(unavailable)');
  }
  lines.push('');

  lines.push('═══ TASK DEPENDENCIES ══════════════════════════════════════════');
  if (deps && (deps.parentTitle || deps.childTitles.length > 0)) {
    if (deps.parentTitle) lines.push(`Blocked by parent: ${deps.parentTitle}`);
    if (deps.childTitles.length > 0) {
      lines.push(`This task blocks:`);
      for (const t of deps.childTitles) lines.push(`  • ${t}`);
    }
  } else {
    lines.push('No dependencies.');
  }
  lines.push('');

  if (memories.length > 0) {
    lines.push('═══ MEMORY RECALL ══════════════════════════════════════════════');
    for (const m of memories) {
      lines.push(`• ${m.created_at.slice(0, 10)}: ${m.value}`);
    }
    lines.push('');
  }

  if (task.blocker_resolved_at) {
    try {
      const bp = JSON.parse(task.blocker_payload ?? '{}') as Record<string, unknown>;
      lines.push('═══ PRIOR RESOLUTION ═══════════════════════════════════════════');
      if (task.blocker_type === 'DECISION') {
        lines.push('This task was previously blocked on a DECISION. A human has responded.');
        if (bp.question) lines.push(`Question: "${bp.question}"`);
        if (Array.isArray(bp.options)) lines.push(`Options were: ${(bp.options as string[]).join(', ')}`);
        if (bp.choice) lines.push(`Human chose: "${bp.choice}"`);
        lines.push('Proceed accordingly — do not ask again.');
      } else if (task.blocker_type === 'CLARIFICATION') {
        lines.push('This task was previously blocked on a CLARIFICATION. A human has responded.');
        if (bp.question) lines.push(`Question: "${bp.question}"`);
        if (bp.response) lines.push(`Human response: "${bp.response}"`);
        lines.push('The task description has been updated with this context. Proceed accordingly.');
      } else if (task.blocker_type === 'RISK') {
        const decision = bp.approved ? 'APPROVED' : 'REJECTED';
        lines.push(`This task was previously blocked on a RISK review. Human decision: ${decision}.`);
        if (bp.description) lines.push(`Risk: "${bp.description}"`);
        if (bp.notes) lines.push(`Notes: "${bp.notes}"`);
        lines.push('Proceed accordingly.');
      }
      lines.push('');
    } catch { /* ignore parse errors */ }
  }

  lines.push('═══ IF YOU CANNOT PROCEED ══════════════════════════════════════');
  lines.push('Do NOT stop silently. Do NOT guess past a decision boundary.');
  lines.push('');
  lines.push('  Need something built first?');
  lines.push('  → create_subtask(parent_task_id, title, description)');
  lines.push('');
  lines.push('  Need a human to choose between approaches?');
  lines.push('  → request_decision(task_id, question, options[])');
  lines.push('');
  lines.push('  Task description unclear?');
  lines.push('  → request_clarification(task_id, question)');
  lines.push('');
  lines.push('  Change is risky and needs review?');
  lines.push('  → flag_risk(task_id, description, severity)');
  lines.push('');
  lines.push('  Wrong tool for this task?');
  lines.push('  → reassign_task(task_id, required_capability, reason)');
  lines.push('');

  lines.push('═══ YOUR TASK ══════════════════════════════════════════════════');
  lines.push(task.description ?? task.title);
  lines.push(`Priority: ${task.priority}. Lease TTL: 5 min (use renew_lease to extend).`);

  return lines.join('\n');
}
