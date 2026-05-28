import { createClient } from 'redis';
import { WebSocket } from 'ws';
const clients = new Set();
export function addClient(ws) {
    clients.add(ws);
}
export function removeClient(ws) {
    clients.delete(ws);
}
function broadcast(channel, message) {
    let payload;
    try {
        payload = JSON.parse(message);
    }
    catch {
        payload = message;
    }
    const data = JSON.stringify({ channel, payload });
    for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    }
}
export async function initRelay() {
    const url = process.env.REDIS_URL;
    if (!url) {
        console.warn('[ws-relay] REDIS_URL not set — WebSocket relay disabled');
        return;
    }
    const subscriber = createClient({ url });
    subscriber.on('error', (err) => console.error('[ws-relay] redis error:', err));
    await subscriber.connect();
    await subscriber.pSubscribe(['task.*', 'project.*'], (message, channel) => {
        broadcast(channel, message);
    });
    console.log('[ws-relay] subscribed to Redis channels task.* and project.*');
}
