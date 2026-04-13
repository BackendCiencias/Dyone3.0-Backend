import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/roles.js';
import { validateRequest } from '../../middlewares/validateRequest.js';
import { attachCampusScope } from '../../shared/authorization.middleware.js';
import {
  activityCollectionParamsSchema,
  activityCreateBodySchema,
  activityParamsSchema,
  activityParticipantsQuerySchema,
  activityUpdateBodySchema,
  createCollectionBodySchema,
  createParticipantBodySchema,
  listActivitiesQuerySchema,
  searchActivityCollectorsQuerySchema,
  searchActivityStudentsQuerySchema,
  updateActivityCollectionBodySchema,
} from './activities.schemas.js';
import {
  addActivityParticipant,
  createActivity,
  createActivityCollection,
  getActivityCollectionReceipt,
  getActivityDetail,
  getActivityParticipants,
  getActivityReport,
  listActivities,
  searchActivityCollectors,
  searchActivityStudents,
  updateActivityCollection,
  updateActivity,
} from './activities.controller.js';

const router = Router();

router.use(authMiddleware);
router.use(requireRoles(['ADMIN', 'SECRETARY', 'AUXILIAR']));
router.use(attachCampusScope());

router.get('/search-collectors', validateRequest({ query: searchActivityCollectorsQuerySchema }), searchActivityCollectors);
router.get('/search-students', validateRequest({ query: searchActivityStudentsQuerySchema }), searchActivityStudents);
router.get('/', validateRequest({ query: listActivitiesQuerySchema }), listActivities);
router.post('/', validateRequest({ body: activityCreateBodySchema }), createActivity);
router.get('/collections/:collectionId/receipt', validateRequest({ params: activityCollectionParamsSchema }), getActivityCollectionReceipt);
router.patch('/collections/:collectionId', validateRequest({ params: activityCollectionParamsSchema, body: updateActivityCollectionBodySchema }), updateActivityCollection);
router.get('/:activityId', validateRequest({ params: activityParamsSchema }), getActivityDetail);
router.patch('/:activityId', validateRequest({ params: activityParamsSchema, body: activityUpdateBodySchema }), updateActivity);
router.get('/:activityId/participants', validateRequest({ params: activityParamsSchema, query: activityParticipantsQuerySchema }), getActivityParticipants);
router.post('/:activityId/participants', validateRequest({ params: activityParamsSchema, body: createParticipantBodySchema }), addActivityParticipant);
router.post('/:activityId/collections', validateRequest({ params: activityParamsSchema, body: createCollectionBodySchema }), createActivityCollection);
router.get('/:activityId/report', validateRequest({ params: activityParamsSchema }), getActivityReport);

export default router;
