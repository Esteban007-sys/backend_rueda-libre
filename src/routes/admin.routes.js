import { Router } from 'express';
import { requireAdminApiKey } from '../middlewares/auth.middleware.js';
import { getMetricas, getReservasAdmin } from '../controllers/admin.controller.js';

const router = Router();

router.use(requireAdminApiKey);

router.get('/metricas', getMetricas);
router.get('/reservas', getReservasAdmin);

export default router;
