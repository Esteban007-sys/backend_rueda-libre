/**
 * Helpers para los tests de Rueda Libre: servidor en proceso,
 * cliente HTTP contra /api y generadores de datos únicos.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import pg from 'pg';

const { Pool } = pg;

export const dbPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
});

export async function startServer() {
  const { default: app } = await import('../src/app.js');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

export function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

async function requestJson(base, method, path, body, headers = {}) {
  const payload = body === undefined ? null : JSON.stringify(body);
  const response = await fetch(base + path, {
    method,
    headers: payload ? { 'Content-Type': 'application/json', ...headers } : { ...headers },
    body: payload,
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, ok: json && json.ok === true };
}

export function getJson(base, path, headers) {
  return requestJson(base, 'GET', path, undefined, headers);
}

export function postJson(base, path, body, headers) {
  return requestJson(base, 'POST', path, body, headers);
}

/** Lee el primer evento que incluye un campo `data:` de la transmisión SSE. */
export async function readSseConnectedEvent(base, path = '/api/stream/ventas') {
  const response = await fetch(base + path, { headers: { Accept: 'text/event-stream' } });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split('\n\n');
    buffer = events.pop();
    for (const block of events) {
      const dataLine = block.split('\n').find((line) => line.startsWith('data: '));
      if (!dataLine) continue;
      return {
        data: JSON.parse(dataLine.slice(6)),
        close: async () => {
          await reader.cancel().catch(() => {});
        },
      };
    }
  }

  throw new Error('No se recibió el evento "connected" del stream de ventas');
}

export function uniqueDoco() {
  const random = Math.floor(Math.random() * 900000000) + 100000000;
  return String(random);
}

export function uniqueCelular() {
  return `3${Math.floor(Math.random() * 1000000000).toString().padStart(9, '0')}`;
}

export function uniqueEmail() {
  return `test-${Math.random().toString(36).slice(2, 12)}@example.com`;
}

/**
 * Devuelve el objeto de la reserva dentro de la respuesta de POST /api/reservas
 * (`reservas` es el nombre de la propiedad definido por el servicio).
 */
export function reservaDe(data) {
  const key = Object.keys(data).find(
    (k) => k.includes('reserv') && typeof data[k] === 'object'
  );
  assert.ok(key, 'la respuesta debe incluir el objeto de la reserva');
  return data[key];
}

/** Devuelve el código de reserva (propiedad que empieza con "codigo") de un objeto de reserva. */
export function codigoDe(reservation) {
  const key = Object.keys(reservation).find((k) => k.startsWith('codigo'));
  assert.ok(key, 'el objeto de la reserva debe incluir el código de reserva');
  return reservation[key];
}

/**
 * Nombre de la columna que guarda el código de reserva en la tabla reservas,
 * consultada a la metadata de la base de datos (robusto a cambios de schema).
 */
export async function codigoColumnName(pool) {
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'reservas' AND column_name LIKE 'codigo%' LIMIT 1`
  );
  assert.ok(rows[0], 'se espera una columna de código de reserva en public.reservas');
  return rows[0].column_name;
}

/**
 * Fecha YYYY-MM-DD cuyo día de la semana (en UTC, base de parseIsoDate)
 * equivale a targetDow, empezando mañana. 0=dom, 1=lun, ..., 6=sáb.
 */
export function fechaConDiaUtc(targetDow) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  let guard = 0;
  while (d.getUTCDay() !== targetDow && guard < 10) {
    d.setUTCDate(d.getUTCDate() + 1);
    guard += 1;
  }
  if (d.getUTCDay() !== targetDow) {
    throw new Error('No se pudo encontrar una fecha con el día de la semana pedido');
  }
  return d.toISOString().slice(0, 10);
}
