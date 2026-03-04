import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  createFamilyService,
  listFamiliesBaseService,
  searchFamiliesService,
  linkStudentFamilyService,
  getFamilyByIdService,
  addTutorToFamilyService,
  setFamilyPrimaryTutorService,
  updateFamilyTutorService,
  deleteFamilyTutorService,
  unlinkStudentFromFamilyService,
} from './families.service.js';

export const createFamily = asyncHandler(async (req, res) => {
  const family = await createFamilyService(req.validated);
  res.status(201).json(family);
});

export const listFamilies = asyncHandler(async (req, res) => {
  const result = await listFamiliesBaseService(req.validatedQuery);
  res.json(result);
});

export const searchFamilies = asyncHandler(async (req, res) => {
  const result = await searchFamiliesService(req.validatedQuery);
  res.json(result);
});

export const linkStudentFamily = asyncHandler(async (req, res) => {
  const result = await linkStudentFamilyService({
    ...req.validated,
    requestId: req.requestId || req.id || 'n/a',
  });
  res.status(200).json(result);
});

export const addFamilyTutor = asyncHandler(async (req, res) => {
  const result = await addTutorToFamilyService(req.validatedParams.id, req.validated);
  res.status(201).json(result);
});

export const setFamilyPrimaryTutor = asyncHandler(async (req, res) => {
  const result = await setFamilyPrimaryTutorService(req.validatedParams.id, req.validated.tutorId);
  res.json(result);
});

export const getFamilyById = asyncHandler(async (req, res) => {
  const data = await getFamilyByIdService(req.validatedParams.id);
  res.json(data);
});


export const updateFamilyTutor = asyncHandler(async (req, res) => {
  const result = await updateFamilyTutorService(
    req.validatedParams.id,
    req.validatedParams.tutorId,
    req.validated,
    req.user?.id
  );
  res.json(result);
});

export const deleteFamilyTutor = asyncHandler(async (req, res) => {
  const result = await deleteFamilyTutorService(
    req.validatedParams.id,
    req.validatedParams.tutorId,
    req.user?.id
  );
  res.json(result);
});

export const unlinkFamilyStudent = asyncHandler(async (req, res) => {
  const result = await unlinkStudentFromFamilyService(
    req.validatedParams.id,
    req.validated.studentId,
    req.user?.id
  );
  res.json(result);
});
