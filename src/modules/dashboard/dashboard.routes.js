import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/roles.js';
import { attachCampusScope } from '../../shared/authorization.middleware.js';
import { validateRequest } from '../../middlewares/validateRequest.js';
import { getSecretaryOverview } from './dashboard.controller.js';
import { secretaryOverviewQuerySchema } from './dashboard.schemas.js';

const router = Router();
const DASHBOARD_READ_ROLES = ['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER', 'SECRETARY_VIEWER', 'AUXILIAR'];

router.use(authMiddleware);

router.get(
  '/secretary/overview',
  requireRoles(DASHBOARD_READ_ROLES),
  attachCampusScope(),
  validateRequest({ query: secretaryOverviewQuerySchema }),
  getSecretaryOverview,
);

export default router;
