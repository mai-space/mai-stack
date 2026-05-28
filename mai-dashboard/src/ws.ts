import { useEffect, useRef } from 'react';
import type { WsEvent } from './types.js';

type Handler = (event: WsEvent) => void;
const handlers = new Set<Handler>();
let socket: WebSocket | null = null;
let retryDelay = 1000;

function connect(): void {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${proto}//${window.location.host}/ws`);

  socket.onopen = () => {
    retryDelay = 1000;
    console.log('[ws] connected');
  };

  socket.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data as string) as WsEvent;
      for (const h of handlers) h(event);
    } catch { /* ignore */ }
  };

  socket.onclose = () => {
    socket = null;
    setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30000);
  };

  socket.onerror = () => {
    socket?.close();
  };
}

connect();

export function subscribe(handler: Handler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function useWsEvents(handler: Handler): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const h = (event: WsEvent) => ref.current(event);
    return subscribe(h);
  }, []);
}
