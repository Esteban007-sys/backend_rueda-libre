/**
 * Endpoints administrativos: protección con x-api-key y respuestas
 * de métricas sobre el estado del sistema.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, closeServer, getJson } from './helpers.mjs';

const ADMIN_KEY = process.env.ADMIN_API_KEY;

describe('Rueda Libre · admin', () => {
  let server;
  let base;

  before(async () => {
    ({ server, base } = await startServer());
  });

  after(async () => {
    await closeServer(server);
  });

  it('requiere el header x-api-key', async () => {
    const sinKey = await getJson(base, '/api/admin/reservas');
    assert.equal(sinKey.status, 401);

    const keyInvalido = await getJson(base, '/api/admin/reservas', { 'x-api-key': 'key-de-prueba' });
    assert.equal(keyInvalido.status, 403);
  });

  it('GET /api/admin/reservas devuelve la lista paginada con la API válida', async () => {
    const res = await getJson(base, '/api/admin/reservas', { 'x-api-key': ADMIN_KEY });
    assert.equal(res.status, 200);
    assert.equal(res.ok, true);
    assert.ok(Number.isInteger(res.json.total));
    assert.ok(Array.isArray(res.json.data));
    assert.ok(Number.isInteger(res.json.limit));
  });

  it('GET /api/admin/metricas devuelve las métricas del sistema y el estado de SSE', async () => {
    const res = await getJson(base, '/api/admin/metricas', { 'x-api-key': ADMIN_KEY });
    assert.equal(res.status, 200);
    assert.equal(res.ok, true);
    assert.ok(res.json.data.resumen);
    assert.ok(Number.isInteger(res.json.data.inventario.stock_total));
    assert.ok(Number.isInteger(res.json.data.tiempo_real.clientes_sse_conectados));
  });
});
