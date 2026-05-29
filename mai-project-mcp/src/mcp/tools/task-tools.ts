import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import { publishStateChange } from '../../redis.js';
import { onTaskDone } from '../../services/blocker.js';
import { z } from 'zod';
import { expireLeases, leaseExpiresAt } from '../../services/lease.js';

export function registerTaskTools(server: any, db: Kysely<Database>, redis: any) {
  server.tool(
    'claim_task',
    {
      project_id: z.string().describe('Project ID to claim a task from'),
      agent_id: z.string().describe('Agent ID claiming the task'),
    },
    async ({ project_id, agent_id }: { project_id: string; agent_id: string }) => {
      await expireLeases(db, redis);
      const task = await db
        .selectFrom('tasks')
        .selectAll()
        .where('project_id', '=', project_id)
        .where('status', '=', 'OPEN')
        .orderBy('priority', 'desc')
        .orderBy('created_at', 'asc')
        .executeTakeFirst();

      if (!task) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No available tasks' }) }] };

      const now = new Date().toISOString();
      const leaseExpires = leaseExpiresAt();
      await db.updateTable('tasks').set({ status: 'IN_PROGRESS', assigned_agent: agent_id, lease_expires_at: leaseExpires, updated_at: now }).where('id', '=', task.id).execute();
      await publishStateChange(redis, task.id, { task_id: task.id, from: 'OPEN', to: 'IN_PROGRESS', agent_id, timestamp: now });

      const updated = await db.selectFrom('tasks').selectAll().where('id', '=', task.id).executeTakeFirstOrThrow();
      return { content: [{ type: 'text' as const, text: JSON.stringify(updated) }] };
    }
  );

  server.tool(
    'complete_task',
    { task_id: z.string().describe('Task ID to mark as complete') },
    async ({ task_id }: { task_id: string }) => {
      const task = await db.selectFrom('tasks').selectAll().where('id', '=', task_id).executeTakeFirst();
      if (!task) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Task not found' }) }] };

      const now = new Date().toISOString();
      await db.updateTable('tasks').set({ status: 'DONE', updated_at: now }).where('id', '=', task_id).execute();
      await publishStateChange(redis, task_id, { task_id, from: task.status, to: 'DONE', timestamp: now });
      await onTaskDone(db, redis, task_id);

      return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, task_id }) }] };
    }
  );

  server.tool(
    'renew_lease',
    {
      task_id: z.string().describe('Task ID'),
      agent_id: z.string().describe('Agent ID (must own the task)'),
    },
    async ({ task_id, agent_id }: { task_id: string; agent_id: string }) => {
      const task = await db.selectFrom('tasks').selectAll().where('id', '=', task_id).executeTakeFirst();
      if (!task) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Task not found' }) }] };
      if (task.assigned_agent !== agent_id) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Not your task' }) }] };

      const leaseExpires = leaseExpiresAt();
      await db.updateTable('tasks').set({ lease_expires_at: leaseExpires, updated_at: new Date().toISOString() }).where('id', '=', task_id).execute();
      return { content: [{ type: 'text' as const, text: JSON.stringify({ renewed: true, lease_expires_at: leaseExpires }) }] };
    }
  );
}
