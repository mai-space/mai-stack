import { z } from 'zod';

const JOURNAL_URL = process.env.JOURNAL_URL ?? 'http://mai-journal:3462';

export function registerJournalTools(server: any): void {
  server.tool(
    'journal_note',
    {
      task_id: z.string().describe('Task ID this note belongs to'),
      message: z.string().describe('Freeform note to record in the task execution journal'),
      agent_id: z.string().optional().describe('Agent ID recording this note'),
    },
    async ({ task_id, message, agent_id }: { task_id: string; message: string; agent_id?: string }) => {
      try {
        const res = await fetch(`${JOURNAL_URL}/journal/${task_id}/entries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'note', agent_id, payload: { message } }),
        });
        const result = await res.json();
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'journal_unreachable', detail: String(err) }) }] };
      }
    }
  );
}
