import { describe, it, expect, vi, afterEach } from 'vitest';
import { appendJournal } from '../src/journalClient.js';

describe('appendJournal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs the entry to the journal service with the given kind and payload', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    global.fetch = fetchMock as any;

    await appendJournal('task-1', 'agent_started', { foo: 'bar' }, { projectId: 'app-a', agentId: 'agent-1' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://mai-journal:3462/journal/task-1/entries',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ project_id: 'app-a', agent_id: 'agent-1', kind: 'agent_started', payload: { foo: 'bar' } }),
      })
    );
  });

  it('never throws when the journal service is unreachable', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as any;

    await expect(appendJournal('task-1', 'error', { message: 'boom' })).resolves.toBeUndefined();
  });

  it('never throws when the journal service responds with an error status', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500 })) as any;
    await expect(appendJournal('task-1', 'note', {})).resolves.toBeUndefined();
  });
});
