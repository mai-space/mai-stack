// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** Minimal WebSocket stand-in — records instances so tests can drive on{open,message,close}. */
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  close() {
    this.closed = true;
    this.onclose?.();
  }
}

describe('mai-dashboard ws client', () => {
  beforeEach(() => {
    vi.resetModules();
    MockWebSocket.instances = [];
    (globalThis as any).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens a websocket to /ws using the current host', async () => {
    await import('../src/ws.js');
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toMatch(/\/ws$/);
  });

  it('dispatches parsed messages to every subscribed handler', async () => {
    const { subscribe } = await import('../src/ws.js');
    const received: unknown[] = [];
    subscribe((event) => received.push(event));

    const socket = MockWebSocket.instances[0];
    socket.onmessage?.({ data: JSON.stringify({ type: 'task_updated', task_id: 't1' }) });

    expect(received).toEqual([{ type: 'task_updated', task_id: 't1' }]);
  });

  it('ignores malformed messages instead of throwing', async () => {
    const { subscribe } = await import('../src/ws.js');
    const received: unknown[] = [];
    subscribe((event) => received.push(event));

    const socket = MockWebSocket.instances[0];
    expect(() => socket.onmessage?.({ data: 'not json' })).not.toThrow();
    expect(received).toHaveLength(0);
  });

  it('unsubscribe stops further delivery to that handler', async () => {
    const { subscribe } = await import('../src/ws.js');
    const received: unknown[] = [];
    const unsubscribe = subscribe((event) => received.push(event));
    unsubscribe();

    MockWebSocket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'x' }) });
    expect(received).toHaveLength(0);
  });

  it('reconnects with backoff after the socket closes', async () => {
    vi.useFakeTimers();
    await import('../src/ws.js');

    expect(MockWebSocket.instances).toHaveLength(1);
    MockWebSocket.instances[0].onclose?.();

    // first retry is scheduled ~1000ms out
    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(2);
  });
});
