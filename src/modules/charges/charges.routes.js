import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/roles.js';
import { validate } from '../../middlewares/validate.js';
import { chargeCreateSchema } from './charges.schemas.js';
import { createCharge } from './charges.controller.js';

const router = Router();

router.use(authMiddleware);
router.use(requireRoles(['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER']));

router.post('/', validate(chargeCreateSchema), createCharge);

export default router;
