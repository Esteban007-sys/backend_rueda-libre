import { checkDatabaseConnection } from '../config/db.js';
import { obtenerCatalogo } from '../services/catalogo.service.js';
import { crearReserva, obtenerReservaPorCodigo } from '../services/reservas.service.js';
import { addClient, emitNuevaReserva } from '../services/sse.service.js';

export async function getHealth(_req, res, next) {
  try {
    const dbTime = await checkDatabaseConnection();

    return res.status(200).json({
      ok: true,
      status: 'ok',
      timestamp: new Date().toISOString(),
      db_time: dbTime,
    });
  } catch (error) {
    return next(error);
  }
}

export async function getCatalogo(_req, res, next) {
  try {
    const catalogo = await obtenerCatalogo();

    return res.status(200).json({
      ok: true,
      data: catalogo,
    });
  } catch (error) {
    return next(error);
  }
}

export async function postReserva(req, res, next) {
  try {
    const resultado = await crearReserva(req.body);

    emitNuevaReserva(resultado);

    return res.status(201).json({
      ok: true,
      data: resultado,
    });
  } catch (error) {
    return next(error);
  }
}

export async function getReservaByCodigo(req, res, next) {
  try {
    const reserva = await obtenerReservaPorCodigo(req.params.codigo);

    return res.status(200).json({
      ok: true,
      data: reserva,
    });
  } catch (error) {
    return next(error);
  }
}

export function streamVentas(req, res) {
  addClient(req, res);
}
