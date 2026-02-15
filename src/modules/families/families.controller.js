import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  createFamilyService,
  searchFamiliesService,
  linkStudentFamilyService,
  getFamilyByIdService,
  addTutorToFamilyService,
  setFamilyPrimaryTutorService,
} from './families.service.js';

export const createFamily = asyncHandler(async (req, res) => {
  const family = await createFamilyService(req.validated);
  res.status(201).json(family);
});

export const searchFamily = asyncHandler(async (req, res) => {
  const result = await searchFamiliesService(req.validatedQuery);
  res.json(result);
});

export const linkStudentFamily = asyncHandler(async (req, res) => {
  const result = await linkStudentFamilyService(req.validated);
  res.status(result.created ? 201 : 200).json(result);
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
