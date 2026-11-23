import crypto from 'node:crypto';
import { pool, query } from '../config/db.js';
import { HttpError } from '../utils/errors.js';

const PLAN_PRICE_COLUMN = {
  '1hora': 'precio_1hora',
  '1_hora': 'precio_1hora',
  hora: 'precio_1hora',
  mediodia: 'precio_mediodia',
  medio_dia: 'precio_mediodia',
  diacompleto: 'precio_diacompleto',
  dia_completo: 'precio_diacompleto',
};

const PLAN_CANONICAL = {
  '1hora': '1hora',
  '1_hora': '1hora',
  hora: '1hora',
  mediodia: 'mediodia',
  medio_dia: 'mediodia',
  diacompleto: 'diacompleto',
  dia_completo: 'diacompleto',
};

const PROMO_ELECTRICA_LUN_JUE = 'DESCUENTO_ELECTRICA_LUN_JUE_20';
const ELECTRICA_DISCOUNT_RATE = 0.2;

/* Patrones y valores permitidos alineados con las restricciones de
   check de la tabla public.reservas (y suelen cumplirse con las
   validaciones que ya hace la API). */
const DOCUMENTO_PATTERN = /^[0-9]{6,10}$/;
const CELULAR_PATTERN = /^3[0-9]{9}$/;
const CANTIDAD_MAX = 6; /* check reservas_cantidad_check */
const CANAL_VALUES = ['web', 'mostrador', 'whatsapp', 'simulador']; /* check reservas_canal_check */

function normalizeText(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isElectricBike(tipo = '') {
  const normalized = normalizeText(tipo);
  return normalized.includes('electric') || normalized.includes('ebike') || normalized.includes('e-bike');
}

function parseIsoDate(fechaStr) {
  if (typeof fechaStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fechaStr.trim())) {
    throw new HttpError(400, 'fecha_alquiler debe tener formato válido YYYY-MM-DD.');
  }

  const trimmed = fechaStr.trim();
  const [year, month, day] = trimmed.split('-').map(Number);
  const dateUtc = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(dateUtc.getTime()) ||
    dateUtc.getUTCFullYear() !== year ||
    dateUtc.getUTCMonth() !== month - 1 ||
    dateUtc.getUTCDate() !== day
  ) {
    throw new HttpError(400, 'fecha_alquiler no corresponde a una fecha calendario válida.');
  }

  return { isoDate: trimmed, dayOfWeek: dateUtc.getUTCDay() };
}

function isMondayToThursday(dayOfWeek) {
  // 0 = Domingo, 1 = Lunes, 2 = Martes, 3 = Miércoles, 4 = Jueves, 5 = Viernes, 6 = Sábado
  return dayOfWeek >= 1 && dayOfWeek <= 4;
}

function generateCodigoReserva(fechaIso) {
  const compactDate = fechaIso.replace(/-/g, '');
  const randomPart = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `RL-${compactDate}-${randomPart}`;
}

function extractClientInput(payload) {
  const source = payload.cliente && typeof payload.cliente === 'object' ? payload.cliente : payload;

  const nombre_completo = String(source.nombre_completo ?? '').trim();
  const documento = String(source.documento ?? '').trim();
  const celular = String(source.celular ?? '').trim();
  const email = String(source.email ?? '').trim().toLowerCase();

  if (!nombre_completo || !documento || !celular || !email) {
    throw new HttpError(
      400,
      'Los datos del cliente son obligatorios: nombre_completo, documento, celular y email.'
    );
  }

  if (!DOCUMENTO_PATTERN.test(documento)) {
    throw new HttpError(
      400,
      'documento debe contener solo números, entre 6 y 10 dígitos (patrón [0-9]{6,10}).'
    );
  }

  if (!CELULAR_PATTERN.test(celular)) {
    throw new HttpError(
      400,
      'celular debe contener 10 dígitos numéricos y comenzar con 3 (patrón 3[0-9]{9}).'
    );
  }

  return { nombre_completo, documento, celular, email };
}

function resolvePlan(rawPlan) {
  const normalized = normalizeText(rawPlan).replace(/\s+/g, '');
  const priceColumn = PLAN_PRICE_COLUMN[normalized];
  const canonicalPlan = PLAN_CANONICAL[normalized];

  if (!priceColumn || !canonicalPlan) {
    throw new HttpError(
      400,
      'plan inválido. Valores permitidos: 1hora, mediodia, diacompleto.'
    );
  }

  return { canonicalPlan, priceColumn };
}

async function upsertCliente(client, clienteData) {
  const existing = await client.query(
    `SELECT id, nombre_completo, documento, celular, email
     FROM clientes
     WHERE documento = $1
     LIMIT 1`,
    [clienteData.documento]
  );

  if (existing.rows.length > 0) {
    const updated = await client.query(
      `UPDATE clientes
       SET nombre_completo = $1,
           celular = $2,
           email = $3
       WHERE id = $4
       RETURNING id, nombre_completo, documento, celular, email`,
      [
        clienteData.nombre_completo,
        clienteData.celular,
        clienteData.email,
        existing.rows[0].id,
      ]
    );
    return updated.rows[0];
  }

  const inserted = await client.query(
    `INSERT INTO clientes (nombre_completo, documento, celular, email)
     VALUES ($1, $2, $3, $4)
     RETURNING id, nombre_completo, documento, celular, email`,
    [
      clienteData.nombre_completo,
      clienteData.documento,
      clienteData.celular,
      clienteData.email,
    ]
  );

  return inserted.rows[0];
}

async function findAndLockBicicleta(client, { bicicleta_id, bicicleta_slug, tipo_bicicleta, cantidad }) {
  let result;

  if (bicicleta_id !== undefined && bicicleta_id !== null && bicicleta_id !== '') {
    result = await client.query(
      `SELECT id, slug, modelo, tipo, precio_1hora, precio_mediodia, precio_diacompleto, stock_total, stock_disponible
       FROM bicicletas
       WHERE id = $1
       FOR UPDATE`,
      [bicicleta_id]
    );
  } else if (bicicleta_slug) {
    result = await client.query(
      `SELECT id, slug, modelo, tipo, precio_1hora, precio_mediodia, precio_diacompleto, stock_total, stock_disponible
       FROM bicicletas
       WHERE slug = $1
       FOR UPDATE`,
      [String(bicicleta_slug).trim()]
    );
  } else if (tipo_bicicleta) {
    const allByType = await client.query(
      `SELECT id, slug, modelo, tipo, precio_1hora, precio_mediodia, precio_diacompleto, stock_total, stock_disponible
       FROM bicicletas
       ORDER BY stock_disponible DESC, id ASC
       FOR UPDATE`
    );

    const targetType = normalizeText(tipo_bicicleta);
    const matching = allByType.rows.filter((b) => normalizeText(b.tipo) === targetType);

    if (matching.length === 0) {
      throw new HttpError(404, `No se encontraron bicicletas de tipo "${tipo_bicicleta}".`);
    }

    const withStock = matching.find((b) => Number(b.stock_disponible) >= cantidad) ?? matching[0];
    result = { rows: [withStock] };
  } else {
    return null;
  }

  if (result.rows.length === 0) {
    throw new HttpError(404, 'La bicicleta seleccionada no existe.');
  }

  const bicicleta = result.rows[0];
  if (Number(bicicleta.stock_disponible) < cantidad) {
    throw new HttpError(
      409,
      `Stock insuficiente para ${bicicleta.modelo}. Disponible: ${bicicleta.stock_disponible}, solicitado: ${cantidad}.`
    );
  }

  return bicicleta;
}

async function findRecorrido(client, { recorrido_id, recorrido_slug }) {
  let result;

  if (recorrido_id !== undefined && recorrido_id !== null && recorrido_id !== '') {
    result = await client.query(
      `SELECT id, slug, nombre, modalidad, nivel, distancia_km, duracion_horas, precio_persona, cupos_diarios
       FROM recorridos
       WHERE id = $1
       FOR UPDATE`,
      [recorrido_id]
    );
  } else if (recorrido_slug) {
    result = await client.query(
      `SELECT id, slug, nombre, modalidad, nivel, distancia_km, duracion_horas, precio_persona, cupos_diarios
       FROM recorridos
       WHERE slug = $1
       FOR UPDATE`,
      [String(recorrido_slug).trim()]
    );
  } else {
    return null;
  }

  if (result.rows.length === 0) {
    throw new HttpError(404, 'El recorrido seleccionado no existe.');
  }

  return result.rows[0];
}

export async function crearReserva(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new HttpError(400, 'El cuerpo de la solicitud es inválido.');
  }

  if (payload.acepto_politicas !== true) {
    throw new HttpError(400, 'Debe aceptar las políticas de alquiler (acepto_politicas: true).');
  }

  const clienteData = extractClientInput(payload);
  const { isoDate: fecha_alquiler, dayOfWeek } = parseIsoDate(payload.fecha_alquiler);

  const cantidad = Number(payload.cantidad);
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > CANTIDAD_MAX) {
    throw new HttpError(400, `cantidad debe ser un número entero entre 1 y ${CANTIDAD_MAX}.`);
  }

  const sede_retiro_id = Number(payload.sede_retiro_id);
  if (!Number.isInteger(sede_retiro_id) || sede_retiro_id < 1) {
    throw new HttpError(400, 'sede_retiro_id es obligatorio (entero mayor o igual a 1).');
  }

  const sede_devolucion_id =
    payload.sede_devolucion_id !== undefined &&
    payload.sede_devolucion_id !== null &&
    payload.sede_devolucion_id !== ''
      ? payload.sede_devolucion_id
      : sede_retiro_id;

  const hasBikeSelection = Boolean(
    payload.bicicleta_id || payload.bicicleta_slug || payload.tipo_bicicleta
  );
  const hasRecorridoSelection = Boolean(payload.recorrido_id || payload.recorrido_slug);

  if (!hasBikeSelection && !hasRecorridoSelection) {
    throw new HttpError(
      400,
      'Debe seleccionar al menos una bicicleta (bicicleta_id, bicicleta_slug o tipo_bicicleta) o un recorrido (recorrido_id o recorrido_slug).'
    );
  }

  /* El plan siempre se valida y normaliza: la columna reservas.plan es
     NOT NULL, incluso cuando la reserva es solo recorrido guiado. */
  const planInfo = resolvePlan(payload.plan ?? '1hora');
  const comentarios = payload.comentarios ? String(payload.comentarios).trim() : null;
  const canal = (payload.canal ? String(payload.canal).trim().toLowerCase() : '') || 'web';
  if (!CANAL_VALUES.includes(canal)) {
    throw new HttpError(
      400,
      `canal inválido. Valores permitidos: ${CANAL_VALUES.join(', ')}.`
    );
  }
  /* El estado inválido "confirmada" rompía la restricción
     check reservas_estado_check; las reservas nuevas empiezan "pendiente". */
  const estado = 'pendiente';

  const dbClient = await pool.connect();

  try {
    await dbClient.query('BEGIN');

    // Validar sedes de retiro y devolución
    const sedesIds =
      String(sede_retiro_id) === String(sede_devolucion_id)
        ? [String(sede_retiro_id)]
        : [String(sede_retiro_id), String(sede_devolucion_id)];

    const sedesCheck = await dbClient.query(
      'SELECT id FROM sedes WHERE id::text = ANY($1::text[])',
      [sedesIds]
    );

    if (sedesCheck.rows.length !== sedesIds.length) {
      throw new HttpError(404, 'Una o ambas sedes especificadas (retiro/devolución) no existen.');
    }

    // Crear o actualizar cliente
    const cliente = await upsertCliente(dbClient, clienteData);

    // Reservar bicicleta y descontar stock si aplica
    let bicicleta = null;
    let subtotalBicicleta = 0;

    if (hasBikeSelection) {
      bicicleta = await findAndLockBicicleta(dbClient, {
        bicicleta_id: payload.bicicleta_id,
        bicicleta_slug: payload.bicicleta_slug,
        tipo_bicicleta: payload.tipo_bicicleta,
        cantidad,
      });

      const unitPrice = Number(bicicleta[planInfo.priceColumn]);
      if (Number.isNaN(unitPrice) || unitPrice < 0) {
        throw new HttpError(400, `Tarifa no configurada para el plan ${planInfo.canonicalPlan}.`);
      }

      subtotalBicicleta = unitPrice * cantidad;

      await dbClient.query(
        `UPDATE bicicletas
         SET stock_disponible = stock_disponible - $1
         WHERE id = $2`,
        [cantidad, bicicleta.id]
      );
    }

    // Validar cupos del recorrido si aplica
    let recorrido = null;
    let subtotalRecorrido = 0;

    if (hasRecorridoSelection) {
      recorrido = await findRecorrido(dbClient, {
        recorrido_id: payload.recorrido_id,
        recorrido_slug: payload.recorrido_slug,
      });

      const cuposUsadosResult = await dbClient.query(
        `SELECT COALESCE(SUM(cantidad), 0)::int AS usados
         FROM reservas
         WHERE recorrido_id = $1
           AND fecha_alquiler = $2
           AND estado <> 'cancelada'`,
        [recorrido.id, fecha_alquiler]
      );

      const usados = cuposUsadosResult.rows[0]?.usados ?? 0;
      const disponibles = Number(recorrido.cupos_diarios) - usados;

      if (disponibles < cantidad) {
        throw new HttpError(
          409,
          `Cupos insuficientes para el recorrido "${recorrido.nombre}" el ${fecha_alquiler}. Disponibles: ${Math.max(disponibles, 0)}, solicitados: ${cantidad}.`
        );
      }

      subtotalRecorrido = Number(recorrido.precio_persona) * cantidad;
    }

    // Calcular descuento del 20% para bicicletas eléctricas de lunes a jueves
    const tipoBicicletaFinal = bicicleta?.tipo ?? (payload.tipo_bicicleta ? String(payload.tipo_bicicleta).trim() : null);
    const promocionEntrada =
      typeof payload.promocion_aplicada === 'string' ? payload.promocion_aplicada.trim() : '';
    let promocion_aplicada = promocionEntrada || 'ninguna';
    let descuentoCop = 0;

    if (bicicleta && isElectricBike(tipoBicicletaFinal) && isMondayToThursday(dayOfWeek)) {
      promocion_aplicada = PROMO_ELECTRICA_LUN_JUE;
      descuentoCop = Math.round(subtotalBicicleta * ELECTRICA_DISCOUNT_RATE);
    }

    promocion_aplicada =
      promocion_aplicada !== null &&
      promocion_aplicada !== undefined &&
      String(promocion_aplicada).trim() !== ''
        ? String(promocion_aplicada).trim()
        : 'ninguna';

    const subtotalCop = Math.round(subtotalBicicleta + subtotalRecorrido);
    const total_cop = Math.max(0, subtotalCop - descuentoCop);
    const codigo_reserva = generateCodigoReserva(fecha_alquiler);

    const reservaResult = await dbClient.query(
      `INSERT INTO reservas (
        codigo_reserva,
        cliente_id,
        sede_retiro_id,
        sede_devolucion_id,
        fecha_alquiler,
        cantidad,
        tipo_bicicleta,
        plan,
        bicicleta_id,
        recorrido_id,
        comentarios,
        acepto_politicas,
        canal,
        promocion_aplicada,
        total_cop,
        estado
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
      [
        codigo_reserva,
        cliente.id,
        sede_retiro_id,
        sede_devolucion_id,
        fecha_alquiler,
        cantidad,
        tipoBicicletaFinal,
        planInfo.canonicalPlan,
        bicicleta?.id ?? null,
        recorrido?.id ?? null,
        comentarios,
        true,
        canal,
        promocion_aplicada,
        total_cop,
        estado,
      ]
    );

    await dbClient.query('COMMIT');

    const reserva = reservaResult.rows[0];

    return {
      reserva,
      cliente,
      bicicleta: bicicleta
        ? {
            id: bicicleta.id,
            slug: bicicleta.slug,
            modelo: bicicleta.modelo,
            tipo: bicicleta.tipo,
            stock_disponible_actual: Number(bicicleta.stock_disponible) - cantidad,
          }
        : null,
      recorrido: recorrido
        ? {
            id: recorrido.id,
            slug: recorrido.slug,
            nombre: recorrido.nombre,
            modalidad: recorrido.modalidad,
            nivel: recorrido.nivel,
          }
        : null,
      resumen_pago: {
        subtotal_cop: subtotalCop,
        descuento_cop: descuentoCop,
        promocion_aplicada,
        total_cop,
      },
    };
  } catch (error) {
    await dbClient.query('ROLLBACK');
    throw error;
  } finally {
    dbClient.release();
  }
}

export async function obtenerReservaPorCodigo(codigo) {
  const cleanCode = String(codigo ?? '').trim();
  if (!cleanCode) {
    throw new HttpError(400, 'El código de reserva es obligatorio.');
  }

  const { rows } = await query(
    `SELECT
      r.*,
      jsonb_build_object(
        'id', c.id,
        'nombre_completo', c.nombre_completo,
        'documento', c.documento,
        'celular', c.celular,
        'email', c.email
      ) AS cliente,
      CASE
        WHEN b.id IS NOT NULL THEN jsonb_build_object(
          'id', b.id,
          'slug', b.slug,
          'modelo', b.modelo,
          'tipo', b.tipo,
          'precio_1hora', b.precio_1hora,
          'precio_mediodia', b.precio_mediodia,
          'precio_diacompleto', b.precio_diacompleto
        )
        ELSE NULL
      END AS bicicleta,
      CASE
        WHEN rec.id IS NOT NULL THEN jsonb_build_object(
          'id', rec.id,
          'slug', rec.slug,
          'nombre', rec.nombre,
          'modalidad', rec.modalidad,
          'nivel', rec.nivel,
          'distancia_km', rec.distancia_km,
          'duracion_horas', rec.duracion_horas,
          'precio_persona', rec.precio_persona
        )
        ELSE NULL
      END AS recorrido,
      to_jsonb(sr) AS sede_retiro,
      to_jsonb(sd) AS sede_devolucion
    FROM reservas r
    INNER JOIN clientes c ON c.id = r.cliente_id
    LEFT JOIN bicicletas b ON b.id = r.bicicleta_id
    LEFT JOIN recorridos rec ON rec.id = r.recorrido_id
    LEFT JOIN sedes sr ON sr.id = r.sede_retiro_id
    LEFT JOIN sedes sd ON sd.id = r.sede_devolucion_id
    WHERE UPPER(r.codigo_reserva) = UPPER($1)
    LIMIT 1`,
    [cleanCode]
  );

  if (rows.length === 0) {
    throw new HttpError(404, `No se encontró ninguna reserva con el código "${cleanCode}".`);
  }

  return rows[0];
}

export async function listarReservasAdmin(filters = {}) {
  const conditions = [];
  const values = [];

  if (filters.estado) {
    values.push(String(filters.estado).trim());
    conditions.push(`LOWER(r.estado) = LOWER($${values.length})`);
  }

  if (filters.canal) {
    values.push(String(filters.canal).trim());
    conditions.push(`LOWER(r.canal) = LOWER($${values.length})`);
  }

  if (filters.tipo_bicicleta) {
    values.push(String(filters.tipo_bicicleta).trim());
    conditions.push(`LOWER(r.tipo_bicicleta) = LOWER($${values.length})`);
  }

  if (filters.fecha_alquiler) {
    values.push(String(filters.fecha_alquiler).trim());
    conditions.push(`r.fecha_alquiler = $${values.length}`);
  }

  if (filters.fecha_desde) {
    values.push(String(filters.fecha_desde).trim());
    conditions.push(`r.fecha_alquiler >= $${values.length}`);
  }

  if (filters.fecha_hasta) {
    values.push(String(filters.fecha_hasta).trim());
    conditions.push(`r.fecha_alquiler <= $${values.length}`);
  }

  if (filters.sede_retiro_id) {
    values.push(filters.sede_retiro_id);
    conditions.push(`r.sede_retiro_id = $${values.length}`);
  }

  if (filters.search) {
    values.push(`%${String(filters.search).trim()}%`);
    const idx = values.length;
    conditions.push(
      `(r.codigo_reserva ILIKE $${idx} OR c.nombre_completo ILIKE $${idx} OR c.documento ILIKE $${idx} OR c.email ILIKE $${idx})`
    );
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const parsedLimit = Number.parseInt(filters.limit ?? 50, 10);
  const limit = Number.isInteger(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 50;

  const parsedOffset = Number.parseInt(filters.offset ?? 0, 10);
  const offset = Number.isInteger(parsedOffset) ? Math.max(parsedOffset, 0) : 0;

  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM reservas r
    INNER JOIN clientes c ON c.id = r.cliente_id
    ${whereClause}
  `;

  const dataQuery = `
    SELECT
      r.*,
      jsonb_build_object(
        'id', c.id,
        'nombre_completo', c.nombre_completo,
        'documento', c.documento,
        'celular', c.celular,
        'email', c.email
      ) AS cliente,
      CASE
        WHEN b.id IS NOT NULL THEN jsonb_build_object(
          'id', b.id,
          'slug', b.slug,
          'modelo', b.modelo,
          'tipo', b.tipo
        )
        ELSE NULL
      END AS bicicleta,
      CASE
        WHEN rec.id IS NOT NULL THEN jsonb_build_object(
          'id', rec.id,
          'slug', rec.slug,
          'nombre', rec.nombre,
          'modalidad', rec.modalidad
        )
        ELSE NULL
      END AS recorrido,
      to_jsonb(sr) AS sede_retiro,
      to_jsonb(sd) AS sede_devolucion
    FROM reservas r
    INNER JOIN clientes c ON c.id = r.cliente_id
    LEFT JOIN bicicletas b ON b.id = r.bicicleta_id
    LEFT JOIN recorridos rec ON rec.id = r.recorrido_id
    LEFT JOIN sedes sr ON sr.id = r.sede_retiro_id
    LEFT JOIN sedes sd ON sd.id = r.sede_devolucion_id
    ${whereClause}
    ORDER BY r.fecha_alquiler DESC, r.id DESC
    LIMIT $${values.length + 1}
    OFFSET $${values.length + 2}
  `;

  const [countResult, dataResult] = await Promise.all([
    query(countQuery, values),
    query(dataQuery, [...values, limit, offset]),
  ]);

  return {
    total: countResult.rows[0]?.total ?? 0,
    limit,
    offset,
    reservas: dataResult.rows,
  };
}

export async function obtenerMetricasAdmin() {
  const [
    resumenResult,
    porCanalResult,
    porTipoResult,
    porPlanResult,
    inventarioResult,
    hoyResult,
  ] = await Promise.all([
    query(`
      SELECT
        COUNT(*)::int AS total_reservas,
        COUNT(*) FILTER (WHERE estado = 'confirmada')::int AS reservas_confirmadas,
        COUNT(*) FILTER (WHERE estado = 'pendiente')::int AS reservas_pendientes,
        COUNT(*) FILTER (WHERE estado = 'cancelada')::int AS reservas_canceladas,
        COALESCE(SUM(total_cop) FILTER (WHERE estado <> 'cancelada'), 0)::bigint AS ingresos_totales_cop,
        COALESCE(ROUND(AVG(total_cop) FILTER (WHERE estado <> 'cancelada')), 0)::bigint AS ticket_promedio_cop,
        COALESCE(SUM(cantidad) FILTER (WHERE estado <> 'cancelada'), 0)::int AS unidades_reservadas,
        COUNT(*) FILTER (WHERE promocion_aplicada IS NOT NULL AND LOWER(TRIM(promocion_aplicada)) NOT IN ('', 'ninguna') AND estado <> 'cancelada')::int AS reservas_con_promocion
      FROM reservas
    `),
    query(`
      SELECT
        COALESCE(canal, 'sin_canal') AS canal,
        COUNT(*)::int AS reservas,
        COALESCE(SUM(total_cop), 0)::bigint AS ingresos_cop
      FROM reservas
      WHERE estado <> 'cancelada'
      GROUP BY COALESCE(canal, 'sin_canal')
      ORDER BY ingresos_cop DESC
    `),
    query(`
      SELECT
        COALESCE(tipo_bicicleta, 'solo_recorrido') AS tipo_bicicleta,
        COUNT(*)::int AS reservas,
        COALESCE(SUM(cantidad), 0)::int AS unidades,
        COALESCE(SUM(total_cop), 0)::bigint AS ingresos_cop
      FROM reservas
      WHERE estado <> 'cancelada'
      GROUP BY COALESCE(tipo_bicicleta, 'solo_recorrido')
      ORDER BY ingresos_cop DESC
    `),
    query(`
      SELECT
        COALESCE(plan, 'sin_plan') AS plan,
        COUNT(*)::int AS reservas,
        COALESCE(SUM(total_cop), 0)::bigint AS ingresos_cop
      FROM reservas
      WHERE estado <> 'cancelada'
      GROUP BY COALESCE(plan, 'sin_plan')
      ORDER BY ingresos_cop DESC
    `),
    query(`
      SELECT
        COALESCE(SUM(stock_total), 0)::int AS stock_total,
        COALESCE(SUM(stock_disponible), 0)::int AS stock_disponible,
        COALESCE(SUM(stock_total - stock_disponible), 0)::int AS en_uso
      FROM bicicletas
    `),
    query(`
      SELECT
        COUNT(*)::int AS reservas_hoy,
        COALESCE(SUM(total_cop), 0)::bigint AS ingresos_hoy_cop
      FROM reservas
      WHERE fecha_alquiler = CURRENT_DATE
        AND estado <> 'cancelada'
    `),
  ]);

  const inventario = inventarioResult.rows[0] ?? {
    stock_total: 0,
    stock_disponible: 0,
    en_uso: 0,
  };

  const ocupacionPorcentaje =
    inventario.stock_total > 0
      ? Number(((inventario.en_uso / inventario.stock_total) * 100).toFixed(2))
      : 0;

  const resumenRaw = resumenResult.rows[0] ?? {};
  const hoyRaw = hoyResult.rows[0] ?? {};

  return {
    resumen: {
      total_reservas: Number(resumenRaw.total_reservas ?? 0),
      reservas_confirmadas: Number(resumenRaw.reservas_confirmadas ?? 0),
      reservas_pendientes: Number(resumenRaw.reservas_pendientes ?? 0),
      reservas_canceladas: Number(resumenRaw.reservas_canceladas ?? 0),
      ingresos_totales_cop: Number(resumenRaw.ingresos_totales_cop ?? 0),
      ticket_promedio_cop: Number(resumenRaw.ticket_promedio_cop ?? 0),
      unidades_reservadas: Number(resumenRaw.unidades_reservadas ?? 0),
      reservas_con_promocion: Number(resumenRaw.reservas_con_promocion ?? 0),
    },
    hoy: {
      reservas_hoy: Number(hoyRaw.reservas_hoy ?? 0),
      ingresos_hoy_cop: Number(hoyRaw.ingresos_hoy_cop ?? 0),
    },
    inventario: {
      ...inventario,
      ocupacion_porcentaje: ocupacionPorcentaje,
    },
    por_canal: porCanalResult.rows.map((row) => ({
      ...row,
      reservas: Number(row.reservas),
      ingresos_cop: Number(row.ingresos_cop),
    })),
    por_tipo_bicicleta: porTipoResult.rows.map((row) => ({
      ...row,
      reservas: Number(row.reservas),
      unidades: Number(row.unidades),
      ingresos_cop: Number(row.ingresos_cop),
    })),
    por_plan: porPlanResult.rows.map((row) => ({
      ...row,
      reservas: Number(row.reservas),
      ingresos_cop: Number(row.ingresos_cop),
    })),
  };
}
