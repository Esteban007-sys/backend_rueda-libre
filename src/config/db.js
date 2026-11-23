import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.warn('[DB] Advertencia: DATABASE_URL no está definida en las variables de entorno.');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (error) => {
  console.error('[DB] Error inesperado en cliente inactivo del pool:', error.message);
});

export async function query(text, params = []) {
  return pool.query(text, params);
}

export async function checkDatabaseConnection() {
  const { rows } = await pool.query('SELECT NOW() AS db_time');
  return rows[0]?.db_time ?? null;
}

export default pool;
