import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import { publishStateChange } from '../../redis.js';
import { z } from 'zod';

export function registerBlockerTools(server: any, db: Kysely<Database>, redis: any) {
  server.tool(
    'create_subtask',
    {
      parent_task_id: z.string().describe('ID of the parent task to block'),
      title: z.string().describe('Title of the subtask'),
      description: z.string().describe('What needs to be done'),
      priority: z.number().int().optional().describe('Priority (default 0)'),
    },
    async ({ parent_task_id, title, description, priority = 0 }: { parent_task_id: string; title: string; description: string; priority?: number }) => {
      const parent = await db.selectFrom('tasks').selectAll().where('id', '=', parent_task_id).executeTakeFirst();
      if (!parent) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Parent task not found' }) }] };

      const subtaskId = crypto.randomUUID();
      const now = new Date().toISOString();

      await db.transaction().execute(async (trx) => {
        await trx.insertInto('tasks').values({
          id: subtaskId, project_id: parent.project_id, title, description, status: 'OPEN',
          priority, assigned_agent: null, lease_expires_at: null,
          parent_task_id, blocker_type: null, blocker_payload: '{}', blocker_resolved_at: null,
          created_at: now, updated_at: now,
        }).execute();

        await trx.updateTable('tasks').set({
          status: 'BLOCKED', blocker_type: 'SUBTASK',
          blocker_payload: JSON.stringify({ subtask_id: subtaskId }),
          updated_at: now,
        }).where('id', '=', parent_task_id).execute();
      });

      await publishStateChange(redis, parent_task_id, { task_id: parent_task_id, from: parent.status, to: 'BLOCKED', blocker_type: 'SUBTASK', subtask_id: subtaskId, timestamp: now });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ subtask_id: subtaskId, parent_task_id }) }] };
    }
  );

  server.tool(
    'request_decision',
    {
      task_id: z.string(),
      question: z.string().describe('The question requiring human decision'),
      options: z.array(z.string()).describe('Available options'),
    },
    async ({ task_id, question, options }: { task_id: string; question: string; options: string[] }) => {
      const task = await db.selectFrom('tasks').selectAll().where('id', '=', task_id).executeTakeFirst();
      if (!task) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Task not found' }) }] };

      const now = new Date().toISOString();
      await db.updateTable('tasks').set({
        status: 'BLOCKED', blocker_type: 'DECISION',
        blocker_payload: JSON.stringify({ question, options }), updated_at: now,
      }).where('id', '=', task_id).execute();

      await publishStateChange(redis, task_id, { task_id, from: task.status, to: 'BLOCKED', blocker_type: 'DECISION', timestamp: now });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ blocked: true, blocker_type: 'DECISION', task_id }) }] };
    }
  );

  server.tool(
    'request_clarification',
    {
      task_id: z.string(),
      question: z.string().describe('What needs clarification'),
    },
    async ({ task_id, question }: { task_id: string; question: string }) => {
      const task = await db.selectFrom('tasks').selectAll().where('id', '=', task_id).executeTakeFirst();
      if (!task) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Task not found' }) }] };

      const now = new Date().toISOString();
      await db.updateTable('tasks').set({
        status: 'BLOCKED', blocker_type: 'CLARIFICATION',
        blocker_payload: JSON.stringify({ question }), updated_at: now,
      }).where('id', '=', task_id).execute();

      await publishStateChange(redis, task_id, { task_id, from: task.status, to: 'BLOCKED', blocker_type: 'CLARIFICATION', timestamp: now });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ blocked: true, blocker_type: 'CLARIFICATION', task_id }) }] };
    }
  );

  server.tool(
    'flag_risk',
    {
      task_id: z.string(),
      description: z.string().describe('Risk description'),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
    },
    async ({ task_id, description, severity }: { task_id: string; description: string; severity: string }) => {
      const task = await db.selectFrom('tasks').selectAll().where('id', '=', task_id).executeTakeFirst();
      if (!task) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Task not found' }) }] };

      const now = new Date().toISOString();
      await db.updateTable('tasks').set({
        status: 'BLOCKED', blocker_type: 'RISK',
        blocker_payload: JSON.stringify({ description, severity }), updated_at: now,
      }).where('id', '=', task_id).execute();

      if (severity === 'critical') {
        // Block all IN_PROGRESS tasks in the same project
        await db.updateTable('tasks')
          .set({ status: 'BLOCKED', blocker_type: 'RISK', blocker_payload: JSON.stringify({ description: `Blocked by critical risk on task ${task_id}`, severity }), updated_at: now })
          .where('project_id', '=', task.project_id)
          .where('status', '=', 'IN_PROGRESS')
          .where('id', '!=', task_id)
          .execute();
      }

      await publishStateChange(redis, task_id, { task_id, from: task.status, to: 'BLOCKED', blocker_type: 'RISK', severity, timestamp: now });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ blocked: true, blocker_type: 'RISK', severity, task_id }) }] };
    }
  );

  server.tool(
    'reassign_task',
    {
      task_id: z.string(),
      required_capability: z.string().describe('The capability tag the correct agent needs'),
      reason: z.string().describe('Why this agent cannot do it'),
    },
    async ({ task_id, required_capability, reason }: { task_id: string; required_capability: string; reason: string }) => {
      const task = await db.selectFrom('tasks').selectAll().where('id', '=', task_id).executeTakeFirst();
      if (!task) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Task not found' }) }] };

      const now = new Date().toISOString();
      // CAPABILITY re-queues to OPEN (not BLOCKED) — it re-routes, doesn't pause
      await db.updateTable('tasks').set({
        status: 'OPEN', assigned_agent: null, lease_expires_at: null,
        blocker_type: 'CAPABILITY',
        blocker_payload: JSON.stringify({ required_capability, reason }), updated_at: now,
      }).where('id', '=', task_id).execute();

      await publishStateChange(redis, task_id, { task_id, from: task.status, to: 'OPEN', blocker_type: 'CAPABILITY', required_capability, timestamp: now });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ reassigned: true, task_id, required_capability }) }] };
    }
  );
}
