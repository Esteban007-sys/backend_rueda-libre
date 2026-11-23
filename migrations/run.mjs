#!/usr/bin/env node
/**
 * Corredor de migraciones para Rueda Libre (PostgreSQL / Supabase).
 *
 * Uso:
 *   node migrations/run.mjs
 *
 * Ejecuta los archivos .sql de ./migrations en orden alfabético,
 * registrando cada uno en la tabla public.migrations.
 */
import 'dotenv/config';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  await pool.query(`CREATE TABLE IF NOT EXISTS public.migrations (
    name text PRIMARY KEY,
    applied_at timestamptz DEFAULT now()
  )`);

  const files = fs
    .readdirSync(ROOT)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('No hay migraciones pendientes.');
  }

  for (const file of files) {
    const applied = await pool.query(`SELECT 1 FROM public.migrations WHERE name = $1`, [file]);
    if (applied.rows.length > 0) {
      console.log(`Ya aplicada: ${file}`);
      continue;
    }

    const sql = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('--') && !s.startsWith('/*'));

    if (statements.length === 0) {
      console.log(`${file}: sin sentencias ejecutables, marcando como aplicada.`);
    }

    for (const stmt of statements) {
      console.log(`Ejecutando ${file}: ${stmt.slice(0, 60).replace(/\s+/g, ' ')}...`);
      await pool.query(stmt);
    }

    await pool.query(`INSERT INTO public.migrations (name) VALUES ($1)`, [file]);
    console.log(`Aplicada: ${file}`);
  }
} catch (error) {
  console.error('ERROR al ejecutar migraciones:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
