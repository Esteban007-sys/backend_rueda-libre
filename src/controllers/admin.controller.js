import { listarReservasAdmin, obtenerMetricasAdmin } from '../services/reservas.service.js';
import { getConnectedClientsCount } from '../services/sse.service.js';

export async function getMetricas(_req, res, next) {
  try {
    const metricas = await obtenerMetricasAdmin();

    return res.status(200).json({
      ok: true,
      data: {
        ...metricas,
        tiempo_real: {
          clientes_sse_conectados: getConnectedClientsCount(),
        },
      },
    });
  } catch (error) {
    return next(error);
  }
}

export async function getReservasAdmin(req, res, next) {
  try {
    const { total, limit, offset, reservas } = await listarReservasAdmin(req.query);

    return res.status(200).json({
      ok: true,
      total,
      limit,
      offset,
      data: reservas,
    });
  } catch (error) {
    return next(error);
  }
}
