import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import ReactFlow, {
  Background, Controls, MiniMap,
  type Node, type Edge,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { Task } from '../types.js';
import { fetchProjectTasks } from '../api.js';
import { useWsEvents } from '../ws.js';

function taskColor(task: Task): string {
  if (task.status === 'DONE') return '#166534';
  if (task.status === 'IN_PROGRESS') return '#1d4ed8';
  if (task.status === 'BLOCKED') {
    const humanTypes = ['DECISION', 'CLARIFICATION', 'RISK'];
    if (task.blocker_type && humanTypes.includes(task.blocker_type)) return '#7f1d1d';
    return '#78350f';
  }
  return '#1e293b';
}

function buildGraph(tasks: Task[]): { nodes: Node[]; edges: Edge[] } {
  if (tasks.length === 0) return { nodes: [], edges: [] };

  const childOf = new Map<string, string>();
  for (const t of tasks) {
    if (t.parent_task_id) childOf.set(t.id, t.parent_task_id);
  }

  const depth = new Map<string, number>();
  const computeDepth = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    const parent = childOf.get(id);
    const d = parent ? computeDepth(parent) + 1 : 0;
    depth.set(id, d);
    return d;
  };
  for (const t of tasks) computeDepth(t.id);

  const byDepth = new Map<number, Task[]>();
  for (const t of tasks) {
    const d = depth.get(t.id) ?? 0;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(t);
  }
  for (const arr of byDepth.values()) arr.sort((a, b) => b.priority - a.priority);

  const nodes: Node[] = [];
  for (const [d, arr] of byDepth.entries()) {
    arr.forEach((t, i) => {
      const label = [
        t.title.length > 40 ? t.title.slice(0, 37) + '…' : t.title,
        `[${t.status}${t.blocker_type ? ':' + t.blocker_type : ''}]`,
        t.assigned_agent ? `@${t.assigned_agent}` : '',
      ].filter(Boolean).join('\n');
      nodes.push({
        id: t.id,
        position: { x: i * 240, y: d * 130 },
        data: { label },
        style: {
          background: taskColor(t),
          color: '#f1f5f9',
          border: '1px solid #334155',
          borderRadius: 8,
          fontSize: 11,
          whiteSpace: 'pre-line',
          width: 200,
        },
      });
    });
  }

  const edges: Edge[] = tasks
    .filter(t => t.parent_task_id)
    .map(t => ({
      id: `${t.parent_task_id}-${t.id}`,
      source: t.parent_task_id!,
      target: t.id,
      animated: t.status !== 'DONE',
      style: { stroke: '#334155' },
    }));

  return { nodes, edges };
}

export default function DependencyGraph() {
  const { id } = useParams<{ id: string }>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  useEffect(() => { void load(); }, [load]);

  useWsEvents(useCallback((event) => {
    if (!event.channel.startsWith('task.')) return;
    const p = event.payload as { project_id?: string };
    if (p.project_id && p.project_id !== id) return;
    void load();
  }, [load, id]));

  if (loading) return <div className="loading">Loading…</div>;
  if (error) return <div className="page"><div className="error-msg">{error}</div></div>;

  const { nodes, edges } = buildGraph(tasks);

  return (
    <div className="page">
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link to="/" style={{ color: 'var(--muted)', fontSize: 14 }}>← Projects</Link>
        <span>{id} — Dependency Graph</span>
      </h1>
      {edges.length === 0 && tasks.length > 0 && (
        <div className="empty" style={{ marginBottom: 12 }}>
          No task dependencies yet (no parent/child relationships exist).
        </div>
      )}
      <div className="graph-container">
        <ReactFlow nodes={nodes} edges={edges} fitView>
          <Background color="#334155" gap={20} />
          <Controls />
          <MiniMap nodeColor={n => (n.style?.background as string) ?? '#1e293b'} />
        </ReactFlow>
      </div>
    </div>
  );
}
