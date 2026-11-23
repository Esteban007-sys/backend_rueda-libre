import { Router } from 'express';
import {
  getHealth,
  getCatalogo,
  getReservaByCodigo,
  postReserva,
  streamVentas,
} from '../controllers/public.controller.js';

const router = Router();

router.get('/health', getHealth);
router.get('/catalogo', getCatalogo);
router.post('/reservas', postReserva);
router.get('/reservas/:codigo', getReservaByCodigo);
router.get('/stream/ventas', streamVentas);

export default router;
