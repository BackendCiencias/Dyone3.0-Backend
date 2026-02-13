import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  createFamilyService,
  searchFamiliesByDniService,
  linkStudentFamilyService,
} from './families.service.js';

export const createFamily = asyncHandler(async (req, res) => {
  const family = await createFamilyService(req.validated);
  res.status(201).json(family);
});

export const searchFamily = asyncHandler(async (req, res) => {
  const { dni } = req.query;
  if (!dni) {
    return res.status(400).json({ message: 'Se requiere DNI para buscar' });
  }
  const families = await searchFamiliesByDniService(dni);
  res.json(families);
});

export const linkStudentFamily = asyncHandler(async (req, res) => {
  const result = await linkStudentFamilyService(req.validated);
  res.status(result.created ? 201 : 200).json(result);
});
