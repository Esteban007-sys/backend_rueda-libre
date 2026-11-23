import cors from 'cors';
import express from 'express';
import adminRoutes from './routes/admin.routes.js';
import publicRoutes from './routes/public.routes.js';

const app = express();

// Orígenes permitidos por defecto para Live Server + orígenes definidos en .env
const LIVE_SERVER_ORIGINS = ['http://127.0.0.1:5500', 'http://localhost:5500'];
const envOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const allowedOrigins = Array.from(new Set([...LIVE_SERVER_ORIGINS, ...envOrigins]));

app.use(
  cors({
    origin(origin, callback) {
      // Permite solicitudes sin Origin (curl, Postman, pruebas locales) y orígenes autorizados
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origen no permitido por CORS: ${origin}`));
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
