import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../db/schema.js';
import { publishStateChange } from '../redis.js';

type RedisClient = any;

export async function onTaskDone(
  db: Kysely<Database>,
  redis: RedisClient | null,
  completedTaskId: string
): Promise<void> {
  let parentId: string | null = null;

  await db.transaction().execute(async (trx: Transaction<Database>) => {
    const completed = await trx
      .selectFrom('tasks')
      .select(['parent_task_id'])
      .where('id', '=', completedTaskId)
      .executeTakeFirst();

    if (!completed?.parent_task_id) return;

    const parent = await trx
      .selectFrom('tasks')
      .select(['id', 'status', 'blocker_type'])
      .where('id', '=', completed.parent_task_id)
      .executeTakeFirst();

    if (!parent || parent.status !== 'BLOCKED' || parent.blocker_type !== 'SUBTASK') return;

    // Count remaining non-done subtasks
    const { count } = await trx
      .selectFrom('tasks')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('parent_task_id', '=', parent.id)
      .where('status', '!=', 'DONE')
      .executeTakeFirstOrThrow();

    if (Number(count) > 0) return; // More subtasks still pending

    await trx
      .updateTable('tasks')
      .set({
        status: 'OPEN',
        blocker_type: null,
        blocker_payload: '{}',
        blocker_resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', parent.id)
      .execute();

    parentId = parent.id;
  });

  if (parentId) {
    await publishStateChange(redis, parentId, {
      task_id: parentId,
      from: 'BLOCKED',
      to: 'OPEN',
      reason: 'subtask_completed',
      resolved_by: completedTaskId,
      timestamp: new Date().toISOString(),
    });
  }
}
