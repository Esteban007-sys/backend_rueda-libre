/**
 * Validaciones de POST /api/reservas: el formulario y cualquier API
 * client deben recibir errores claros (400/404), no 500 del servidor,
 * cuando falta o estropean el cuerpo de la solicitud.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer,
  closeServer,
  postJson,
  uniqueDoco,
  uniqueCelular,
  uniqueEmail,
  fechaConDiaUtc,
  dbPool,
} from './helpers.mjs';

const BASE_PAYLOAD = {
  nombre_completo: 'Test Validaciones',
  documento: uniqueDoco(),
  celular: uniqueCelular(),
  email: uniqueEmail(),
  fecha_alquiler: fechaConDiaUtc(2),
  cantidad: 1,
  sede_retiro_id: 1,
  sede_devolucion_id: 1,
  plan: '1hora',
  acepto_politicas: true,
  canal: 'web',
  bicicleta_slug: 'urbana-clasica',
};

describe('Rueda Libre · validación de reservas', () => {
  let server;
  let base;

  before(async () => {
    ({ server, base } = await startServer());
  });

  after(async () => {
    await closeServer(server);
  });

  it('devuelve 400 si no se aceptan las políticas de alquiler', async () => {
    const res = await postJson(base, '/api/reservas', { ...BASE_PAYLOAD, acepto_politicas: false });
    assert.equal(res.status, 400);
    assert.equal(res.ok, false);
    assert.match(res.json.error, /pol/);
  });

  it('devuelve 400 si faltan datos del cliente', async () => {
    for (const campo of ['nombre_completo', 'documento', 'celular', 'email']) {
      const payload = { ...BASE_PAYLOAD, [campo]: '' };
      const res = await postJson(base, '/api/reservas', payload);
      assert.equal(res.status, 400, `esperaba 400 sin ${campo}`);
    }
  });

  it('devuelve 400 si el documento no es [0-9]{6,10}', async () => {
    for (const documento of ['abc', '123', '12345678901', '12.345.678']) {
      const res = await postJson(base, '/api/reservas', { ...BASE_PAYLOAD, documento });
      assert.equal(res.status, 400, `esperaba 400 para documento "${documento}"`);
    }
  });

  it('devuelve 400 si el celular no tiene el formato 3[0-9]{9}', async () => {
    for (const celular of ['312555555', '2123456789', '31255555555', 'abc']) {
      const res = await postJson(base, '/api/reservas', { ...BASE_PAYLOAD, celular });
      assert.equal(res.status, 400, `esperaba 400 para celular "${celular}"`);
    }
  });

  it('devuelve 400 si fecha_alquiler no es YYYY-MM-DD válida', async () => {
    for (const fecha of ['2026-02-30', '26/11/2023', '2026-13-10', '2026-11-32', '202611-23']) {
      const res = await postJson(base, '/api/reservas', { ...BASE_PAYLOAD, fecha_alquiler: fecha });
      assert.equal(res.status, 400, `esperaba 400 para fecha "${fecha}"`);
    }
  });

  it('devuelve 400 si el plan no está permitido', async () => {
    const res = await postJson(base, '/api/reservas', { ...BASE_PAYLOAD, plan: 'extranoche' });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /plan inválido/);
  });

  it('devuelve 400 si cantidad no es un entero entre 1 y 6', async () => {
    for (const cantidad of [0, -1, 7, 100, 'abc', 1.5, undefined]) {
      const res = await postJson(base, '/api/reservas', { ...BASE_PAYLOAD, cantidad });
      assert.equal(res.status, 400, `esperaba 400 para cantidad ${cantidad}`);
    }
  });

  it('devuelve 400 si sede_retiro_id no es un entero >= 1', async () => {
    for (const sede of [0, -1, 'abc', null, undefined]) {
      const res = await postJson(base, '/api/reservas', { ...BASE_PAYLOAD, sede_retiro_id: sede });
      assert.equal(res.status, 400, `esperaba 400 para sede_retiro_id ${sede}`);
    }
  });

  it('devuelve 400 si el canal no está permitido', async () => {
    const res = await postJson(base, '/api/reservas', { ...BASE_PAYLOAD, canal: 'facebook' });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /canal inválido/);
  });

  it('devuelve 400 si ni bicicleta ni recorrido se seleccionan', async () => {
    const payload = { ...BASE_PAYLOAD };
    delete payload.bicicleta_slug;
    const res = await postJson(base, '/api/reservas', payload);
    assert.equal(res.status, 400);
    assert.match(res.json.error, /seleccionar al menos una bicicleta/);
  });

  it('devuelve 404 si la bicicleta no existe', async () => {
    const res = await postJson(base, '/api/reservas', { ...BASE_PAYLOAD, bicicleta_slug: 'nope-nope' });
    assert.equal(res.status, 404);
  });

  it('devuelve 404 si la sede de retiro no existe', async () => {
    const res = await postJson(base, '/api/reservas', { ...BASE_PAYLOAD, sede_retiro_id: 9999 });
    assert.equal(res.status, 404);
  });

  it('devuelve 404 si el recorrido no existe', async () => {
    const payload = { ...BASE_PAYLOAD, bicicleta_slug: undefined, recorrido_slug: 'no-existe' };
    const res = await postJson(base, '/api/reservas', payload);
    assert.equal(res.status, 404);
  });

  it('no deja trazas en la base de datos de las reservas rechazadas', async () => {
    const documento = uniqueDoco();
    const payload = { ...BASE_PAYLOAD, nombre_completo: '', documento };
    const res = await postJson(base, '/api/reservas', payload);
    assert.equal(res.status, 400);
    const { rows } = await dbPool.query(
      'SELECT COUNT(*)::int AS n FROM clientes WHERE documento = $1',
      [documento]
    );
    assert.equal(rows[0].n, 0);
  });
});
