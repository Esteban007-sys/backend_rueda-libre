/**
 * El stream SSE (/api/stream/ventas) conecta clientes y emite el
 * evento "connected" con el id de cliente; métricas de admin muestran
 * los clientes conectados.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer,
  closeServer,
  getJson,
  readSseConnectedEvent,
} from './helpers.mjs';

const ADMIN_KEY = process.env.ADMIN_API_KEY;

async function esperarConteoSse(base, minimo, timeoutMs = 3000) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    const res = await getJson(base, '/api/admin/metricas', { 'x-api-key': ADMIN_KEY });
    const conectados = Number(res.json?.data?.tiempo_real?.clientes_sse_conectados ?? 0);
    if (conectados >= minimo) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

describe('Rueda Libre · stream SSE', () => {
  let server;
  let base;

  before(async () => {
    ({ server, base } = await startServer());
  });

  after(async () => {
    await closeServer(server);
  });

  it('emite un evento "connected" al conectarse', async () => {
    const { data, close } = await readSseConnectedEvent(base);
    try {
      assert.ok(data.message, 'el evento debe tener un mensaje de conexión');
      assert.ok(typeof data.clientId === 'string' && data.clientId.length > 0);
    } finally {
      await close();
    }
  });

  it('cuenta los clientes conectados en métricas de admin', async () => {
    const { close } = await readSseConnectedEvent(base);
    try {
      assert.ok(
        await esperarConteoSse(base, 1),
        'al menos un cliente SSE conectado según /api/admin/metricas'
      );
    } finally {
      await close();
    }
  });
});
