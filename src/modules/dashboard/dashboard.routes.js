import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/roles.js';
import { attachCampusScope } from '../../shared/authorization.middleware.js';
import { validateRequest } from '../../middlewares/validateRequest.js';
import { getAdminOverview, getSecretaryOverview } from './dashboard.controller.js';
import { adminOverviewQuerySchema, secretaryOverviewQuerySchema } from './dashboard.schemas.js';

const router = Router();
const DASHBOARD_READ_ROLES = ['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER', 'SECRETARY_VIEWER', 'AUXILIAR'];
const DASHBOARD_ADMIN_ROLES = ['ADMIN'];

router.use(authMiddleware);

router.get(
  '/secretary/overview',
  requireRoles(DASHBOARD_READ_ROLES),
  attachCampusScope(),
  validateRequest({ query: secretaryOverviewQuerySchema }),
  getSecretaryOverview,
);

router.get(
  '/admin/overview',
  requireRoles(DASHBOARD_ADMIN_ROLES),
  attachCampusScope(),
  validateRequest({ query: adminOverviewQuerySchema }),
  getAdminOverview,
);

export default router;
