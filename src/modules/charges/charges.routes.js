import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/roles.js';
import { validate } from '../../middlewares/validate.js';
import { validateRequest } from '../../middlewares/validateRequest.js';
import { chargeCreateSchema, chargeIdParamsSchema, chargeUpdateSchema } from './charges.schemas.js';
import { createCharge, deleteCharge, updateCharge } from './charges.controller.js';

const router = Router();

router.use(authMiddleware);
router.use(requireRoles(['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER']));

router.post('/', validate(chargeCreateSchema), createCharge);
router.patch('/:id', validateRequest({ params: chargeIdParamsSchema, body: chargeUpdateSchema }), updateCharge);
router.delete('/:id', validateRequest({ params: chargeIdParamsSchema }), deleteCharge);

export default router;
