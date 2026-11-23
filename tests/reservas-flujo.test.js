/**
 * Flujo de reservas contra la base de datos real (el mismo flujo que
 * ejecuta el formulario de paginas/reservas.html): creación por slug
 * y por tipo de bicicleta, descuentos, cupos de recorridos, consulta
 * por código y trazas de integridad.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer,
  closeServer,
  getJson,
  postJson,
  uniqueDoco,
  uniqueCelular,
  uniqueEmail,
  fechaConDiaUtc,
  dbPool,
  reservaDe,
  codigoDe,
  codigoColumnName,
} from './helpers.mjs';

describe('Rueda Libre · flujo de reservas', () => {
  let server;
  let base;
  let catalogo;
  const codigosCreados = [];
  const documentosCreados = [];
  const stockOriginal = new Map();
  const cuposOriginal = new Map();
  let codeCol;

  before(async () => {
    ({ server, base } = await startServer());
    catalogo = (await getJson(base, '/api/catalogo')).json.data;
    assert.ok(catalogo, 'el catálogo debe responder antes de ejecutar las pruebas');

    for (const bici of catalogo.bicicletas) {
      stockOriginal.set(bici.slug, Number(bici.stock_disponible));
    }
    const cupos = await dbPool.query('SELECT slug, cupos_diarios FROM recorridos');
    for (const row of cupos.rows) {
      cuposOriginal.set(row.slug, Number(row.cupos_diarios));
    }
    codeCol = await codigoColumnName(dbPool);
  });

  after(async () => {
    if (codigosCreados.length > 0) {
      await dbPool.query(`DELETE FROM reservas WHERE ${codeCol} = ANY($1::text[])`, [codigosCreados]);
    }
    if (documentosCreados.length > 0) {
      await dbPool.query('DELETE FROM clientes WHERE documento = ANY($1)', [documentosCreados]);
    }
    for (const [slug, stock] of stockOriginal) {
      await dbPool.query('UPDATE bicicletas SET stock_disponible = $1 WHERE slug = $2', [stock, slug]);
    }
    for (const [slug, cupos] of cuposOriginal) {
      await dbPool.query('UPDATE recorridos SET cupos_diarios = $1 WHERE slug = $2', [cupos, slug]);
    }
    await closeServer(server);
  });

  function payloadBase(overrides = {}) {
    return {
      nombre_completo: 'Flujo Bici',
      documento: uniqueDoco(),
      celular: uniqueCelular(),
      email: uniqueEmail(),
      fecha_alquiler: fechaConDiaUtc(6),
      cantidad: 1,
      sede_retiro_id: 1,
      sede_devolucion_id: 1,
      plan: '1hora',
      acepto_politicas: true,
      canal: 'web',
      bicicleta_slug: 'urbana-clasica',
      ...overrides,
    };
  }

  async function crear(payload) {
    const res = await postJson(base, '/api/reservas', payload);
    if (res.status === 201) {
      codigosCreados.push(codigoDe(reservaDe(res.json.data)));
      documentosCreados.push(res.json.data.cliente.documento);
    }
    return res;
  }

  it('crea una reserva con bicicleta_slug (equivalente al formulario)', async () => {
    const bici = catalogo.bicicletas.find((b) => b.slug === 'urbana-clasica');
    assert.ok(bici, 'se espera la bicicleta urbana-clasica en el catálogo');

    const res = await crear(payloadBase());
    assert.equal(res.status, 201, JSON.stringify(res.json));
    const data = res.json.data;
    const reserva = reservaDe(data);

    assert.match(codigoDe(reserva), /^RL-\d{8}-[0-9A-F]{6}$/);
    assert.equal(reserva.estado, 'pendiente');
    assert.equal(reserva.tipo_bicicleta, bici.tipo);
    assert.equal(reserva.bicicleta_id, bici.id);
    assert.equal(reserva.plan, '1hora');
    assert.equal(reserva.sede_retiro_id, 1);
    assert.equal(data.bicicleta.stock_disponible_actual, Number(bici.stock_disponible) - 1);
    assert.equal(data.resumen_pago.total_cop, Number(bici.precio_1hora));
    assert.equal(data.resumen_pago.descuento_cop, 0);
    assert.equal(data.resumen_pago.promocion_aplicada, 'ninguna');

    const consulta = await getJson(base, `/api/reservas/${codigoDe(reserva)}`);
    assert.equal(consulta.status, 200);
    assert.equal(codigoDe(consulta.json.data), codigoDe(reserva));
    assert.equal(consulta.json.data.cliente.documento, data.cliente.documento);
    assert.ok(consulta.json.data.sede_retiro);
  });

  it('crea una reserva recorrido-guiado: tipo_bicicleta null y precio por persona', async () => {
    const recorrido = catalogo.recorridos.find((r) => r.slug === 'rio-y-parques');
    assert.ok(recorrido);

    const payload = payloadBase({
      nombre_completo: 'Flujo Rueda',
      fecha_alquiler: fechaConDiaUtc(2),
      cantidad: 2,
      sede_retiro_id: 2,
      sede_devolucion_id: 3,
      recorrido_slug: 'rio-y-parques',
    });
    delete payload.bicicleta_slug;

    const res = await crear(payload);
    assert.equal(res.status, 201, JSON.stringify(res.json));
    const reserva = reservaDe(res.json.data);

    assert.equal(reserva.recorrido_id, recorrido.id);
    assert.equal(reserva.tipo_bicicleta, null);
    assert.equal(reserva.bicicleta_id, null);
    assert.equal(reserva.sede_retiro_id, 2);
    assert.equal(reserva.sede_devolucion_id, 3);
    assert.equal(reserva.plan, '1hora');
    assert.equal(reserva.total_cop, Math.round(Number(recorrido.precio_persona) * 2));
    assert.equal(res.json.data.resumen_pago.descuento_cop, 0);
  });

  it('aplica el descuento 20% de lunes a jueves en bicicleta eléctrica', async () => {
    const electrica = catalogo.bicicletas.find((b) => b.tipo === 'electrica' && Number(b.stock_disponible) > 0);
    assert.ok(electrica, 'se espera una bicicleta eléctrica disponible en el catálogo');

    const subtotal = Math.round(Number(electrica.precio_mediodia) * 1);
    const descuento = Math.round(subtotal * 0.2);

    const payload = payloadBase({
      nombre_completo: 'Flujo Eléctrica',
      fecha_alquiler: fechaConDiaUtc(1), // lunes → descuento
      plan: 'mediodia',
      tipo_bicicleta: 'electrica',
    });
    delete payload.bicicleta_slug;

    const res = await crear(payload);
    assert.equal(res.status, 201, JSON.stringify(res.json));
    const reserva = reservaDe(res.json.data);

    assert.equal(reserva.bicicleta_id, electrica.id);
    assert.equal(reserva.tipo_bicicleta, 'electrica');
    assert.equal(res.json.data.resumen_pago.promocion_aplicada, 'DESCUENTO_ELECTRICA_LUN_JUE_20');
    assert.equal(res.json.data.resumen_pago.descuento_cop, descuento);
    assert.equal(res.json.data.resumen_pago.total_cop, subtotal - descuento);
    assert.ok(res.json.data.resumen_pago.total_cop > 0);
  });

  it('no aplica descuento a la eléctrica cuando se reserva un sábado', async () => {
    const electrica = catalogo.bicicletas.find((b) => b.tipo === 'electrica' && Number(b.stock_disponible) > 0);
    assert.ok(electrica, 'se espera una bicicleta eléctrica disponible en el catálogo');

    const payload = payloadBase({
      nombre_completo: 'Flujo Eléctrica Sábado',
      fecha_alquiler: fechaConDiaUtc(6), // sábado
      plan: 'mediodia',
      tipo_bicicleta: 'electrica',
    });
    delete payload.bicicleta_slug;

    const res = await crear(payload);
    assert.equal(res.status, 201, JSON.stringify(res.json));

    assert.equal(res.json.data.resumen_pago.promocion_aplicada, 'ninguna');
    assert.equal(res.json.data.resumen_pago.descuento_cop, 0);
    assert.equal(res.json.data.resumen_pago.total_cop, Math.round(Number(electrica.precio_mediodia) * 1));
  });

  it('devuelve 409 si el stock de la bicicleta es insuficiente', async () => {
    const { rows } = await dbPool.query(
      `SELECT slug, stock_disponible FROM bicicletas
       WHERE stock_disponible > 0 AND stock_disponible < 6
       ORDER BY id LIMIT 1`
    );
    assert.ok(rows.length > 0, 'se espera una bicicleta con 0 < stock_disponible < 6');

    const slug = rows[0].slug;
    const cantidad = Number(rows[0].stock_disponible) + 1;

    const res = await postJson(base, '/api/reservas', payloadBase({ bicicleta_slug: slug, cantidad }));
    assert.equal(res.status, 409, JSON.stringify(res.json));
    assert.match(res.json.error, /insuficiente/i);

    const { rows: after } = await dbPool.query('SELECT stock_disponible FROM bicicletas WHERE slug = $1', [slug]);
    assert.equal(Number(after[0].stock_disponible), Number(rows[0].stock_disponible));
  });

  it('devuelve 409 si los cupos diarios del recorrido se agotan', async () => {
    const fecha = fechaConDiaUtc(3);
    await dbPool.query('UPDATE recorridos SET cupos_diarios = 1 WHERE slug = $1', ['rio-y-parques']);

    const payload = payloadBase({
      nombre_completo: 'Flujo Cupos',
      fecha_alquiler: fecha,
      recorrido_slug: 'rio-y-parques',
    });
    delete payload.bicicleta_slug;

    const res1 = await crear(payload);
    assert.equal(res1.status, 201, JSON.stringify(res1.json));

    const res2 = await crear(payload);
    assert.equal(res2.status, 409, JSON.stringify(res2.json));
    assert.match(res2.json.error, /insuficiente/i);
  });
});
