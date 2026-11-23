import cors from 'cors';
import express from 'express';
import adminRoutes from './routes/admin.routes.js';
import publicRoutes from './routes/public.routes.js';
import { HttpError } from './utils/errors.js';

const app = express();

// Confía en el primer proxy inverso (Caddy/Nginx en Oracle Cloud) para cabeceras X-Forwarded-*
app.set('trust proxy', 1);

// Orígenes permitidos por defecto (Live Server local + GitHub Pages + dominio HTTPS) + .env
const DEFAULT_ORIGINS = [
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'https://esteban007-sys.github.io',
  'https://rueda-libre-api.duckdns.org',
];

const normalizeOrigin = (value) => value.trim().replace(/\/+$/, '');
const envOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map(normalizeOrigin)
  .filter(Boolean);
const allowedOrigins = Array.from(new Set([...DEFAULT_ORIGINS, ...envOrigins]));

app.use(
  cors({
    origin(origin, callback) {
      // Permite solicitudes sin Origin (curl, Postman, healthchecks) y orígenes autorizados
      if (!origin || allowedOrigins.includes(normalizeOrigin(origin))) {
        return callback(null, true);
      }
      return callback(new HttpError(403, `Origen no permitido por CORS: ${origin}`));
    },
  })
);

app.use(express.json());
app.use('/api', publicRoutes);
app.use('/api/admin', adminRoutes);

app.use((err, _req, res, _next) => {
  res.status(err.statusCode || 500).json({ ok: false, error: err.message || 'Server error' });
});

export default app;
