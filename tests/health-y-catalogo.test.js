/**
 * Salud y catálogo: GET /api/health y GET /api/catalogo responden
 * con los datos que los consumidores esperan (y sobre los que se
 * corren las demás pruebas).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, closeServer, getJson } from './helpers.mjs';

describe('Rueda Libre · salud y catálogo', () => {
  let server;
  let base;

  before(async () => {
    ({ server, base } = await startServer());
  });

  after(async () => {
    await closeServer(server);
  });

  it('GET /api/health responde ok y el tiempo de conexión a la base de datos', async () => {
    const res = await getJson(base, '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.ok, true);
    assert.equal(res.json.status, 'ok');
    assert.equal(typeof res.json.timestamp, 'string');
    assert.ok(typeof res.json.db_time === 'string');
  });

  it('GET /api/catalogo responde con sedes, bicicletas, recorridos y la promoción activa', async () => {
    const res = await getJson(base, '/api/catalogo');
    assert.equal(res.status, 200);
    assert.equal(res.ok, true);

    const data = res.json.data;
    assert.ok(Array.isArray(data.sedes) && data.sedes.length >= 1);
    assert.ok(Array.isArray(data.bicicletas) && data.bicicletas.length >= 1);
    assert.ok(Array.isArray(data.recorridos) && data.recorridos.length >= 1);
    assert.ok(Array.isArray(data.promociones) && data.promociones[0]?.codigo);

    for (const sede of data.sedes) {
      assert.ok(Number.isInteger(sede.id));
      assert.ok(typeof sede.nombre === 'string');
    }
    for (const bici of data.bicicletas) {
      assert.ok(typeof bici.slug === 'string' && bici.slug.length > 0);
      assert.ok(Number.isInteger(bici.stock_disponible));
      assert.ok(Number.isInteger(bici.precio_1hora));
    }
    for (const recorrido of data.recorridos) {
      assert.ok(typeof recorrido.slug === 'string' && recorrido.slug.length > 0);
    }
  });
});
