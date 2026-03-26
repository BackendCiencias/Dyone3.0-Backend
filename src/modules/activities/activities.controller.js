import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  addActivityParticipantService,
  createActivityCollectionService,
  createActivityService,
  getActivityCollectionReceiptService,
  getActivityDetailService,
  getActivityParticipantsService,
  getActivityReportService,
  listActivitiesService,
  searchActivityStudentsService,
  updateActivityService,
} from './activities.service.js';

function getActiveRoleHeader(req) {
  return req.headers['x-active-role'];
}

export const listActivities = asyncHandler(async (req, res) => {
  const data = await listActivitiesService({
    filters: req.validatedQuery,
    user: req.user,
    activeRole: getActiveRoleHeader(req),
    campusScope: req.campusScope,
  });
  res.json(data);
});

export const createActivity = asyncHandler(async (req, res) => {
  const data = await createActivityService({
    payload: req.validated,
    user: req.user,
    activeRole: getActiveRoleHeader(req),
    campusScope: req.campusScope,
  });
  res.status(201).json(data);
});

export const updateActivity = asyncHandler(async (req, res) => {
  const data = await updateActivityService({
    activityId: req.validatedParams.activityId,
    payload: req.validated,
    user: req.user,
    activeRole: getActiveRoleHeader(req),
    campusScope: req.campusScope,
  });
  res.json(data);
});

export const getActivityDetail = asyncHandler(async (req, res) => {
  const data = await getActivityDetailService({
    activityId: req.validatedParams.activityId,
    user: req.user,
    activeRole: getActiveRoleHeader(req),
    campusScope: req.campusScope,
  });
  res.json(data);
});

export const getActivityParticipants = asyncHandler(async (req, res) => {
  const data = await getActivityParticipantsService({
    activityId: req.validatedParams.activityId,
    filters: req.validatedQuery,
    user: req.user,
    activeRole: getActiveRoleHeader(req),
    campusScope: req.campusScope,
  });
  res.json(data);
});

export const addActivityParticipant = asyncHandler(async (req, res) => {
  const data = await addActivityParticipantService({
    activityId: req.validatedParams.activityId,
    payload: req.validated,
    user: req.user,
    activeRole: getActiveRoleHeader(req),
    campusScope: req.campusScope,
  });
  res.status(201).json(data);
});

export const createActivityCollection = asyncHandler(async (req, res) => {
  const data = await createActivityCollectionService({
    activityId: req.validatedParams.activityId,
    payload: req.validated,
    user: req.user,
    activeRole: getActiveRoleHeader(req),
    campusScope: req.campusScope,
  });
  res.status(201).json(data);
});

export const getActivityReport = asyncHandler(async (req, res) => {
  const data = await getActivityReportService({
    activityId: req.validatedParams.activityId,
    user: req.user,
    activeRole: getActiveRoleHeader(req),
    campusScope: req.campusScope,
  });
  res.json(data);
});

export const searchActivityStudents = asyncHandler(async (req, res) => {
  const data = await searchActivityStudentsService({
    filters: req.validatedQuery,
    user: req.user,
    activeRole: getActiveRoleHeader(req),
    campusScope: req.campusScope,
  });
  res.json(data);
});

export const getActivityCollectionReceipt = asyncHandler(async (req, res) => {
  const data = await getActivityCollectionReceiptService({
    collectionId: req.validatedParams.collectionId,
    user: req.user,
    activeRole: getActiveRoleHeader(req),
    campusScope: req.campusScope,
  });
  res.json(data);
});
