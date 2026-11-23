import crypto from 'node:crypto';

export function requireAdminApiKey(req, res, next) {
  const configuredKey = process.env.ADMIN_API_KEY;

  if (!configuredKey) {
    return res.status(500).json({
      ok: false,
      error: 'ADMIN_API_KEY no está configurada en el servidor.',
    });
  }

  const providedKey = req.headers['x-api-key'];

  if (typeof providedKey !== 'string' || !providedKey.trim()) {
    return res.status(401).json({
      ok: false,
      error: 'Falta el header de autenticación x-api-key.',
    });
  }

  const expectedBuffer = Buffer.from(configuredKey, 'utf8');
  const providedBuffer = Buffer.from(providedKey.trim(), 'utf8');

  const isValid =
    expectedBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, providedBuffer);

  if (!isValid) {
    return res.status(403).json({
      ok: false,
      error: 'x-api-key inválida.',
    });
  }

  return next();
}
