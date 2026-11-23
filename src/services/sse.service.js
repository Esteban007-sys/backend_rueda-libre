import crypto from 'node:crypto';

const clients = new Map();
const HEARTBEAT_INTERVAL_MS = 25000;

function formatSseMessage(eventName, data, id = null) {
  let payload = '';
  if (id) {
    payload += `id: ${id}\n`;
  }
  if (eventName) {
    payload += `event: ${eventName}\n`;
  }
  payload += `data: ${JSON.stringify(data)}\n\n`;
  return payload;
}

export function addClient(req, res) {
  const clientId = crypto.randomUUID();

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  res.write('retry: 5000\n\n');
  res.write(
    formatSseMessage('connected', {
      clientId,
      message: 'Conectado al stream de ventas de Rueda Libre',
      timestamp: new Date().toISOString(),
    })
  );

  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    } catch {
      removeClient(clientId);
    }
  }, HEARTBEAT_INTERVAL_MS);

  clients.set(clientId, { res, heartbeat });

  req.on('close', () => {
    removeClient(clientId);
  });

  return clientId;
}

export function removeClient(clientId) {
  const client = clients.get(clientId);
  if (!client) return;

  clearInterval(client.heartbeat);
  clients.delete(clientId);
}

export function broadcastEvent(eventName, data) {
  const eventId = crypto.randomUUID();
  const message = formatSseMessage(eventName, data, eventId);

  for (const [clientId, client] of clients.entries()) {
    try {
      client.res.write(message);
    } catch {
      removeClient(clientId);
    }
  }
}

export function emitNuevaReserva(reservaData) {
  broadcastEvent('nueva_reserva', {
    ...reservaData,
    emitted_at: new Date().toISOString(),
  });
}

export function getConnectedClientsCount() {
  return clients.size;
}
