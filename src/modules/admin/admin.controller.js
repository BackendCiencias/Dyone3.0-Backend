import {
  createCampus,
  listCampuses,
  createCycle,
  listCycles,
  createClassroom,
  listClassrooms,
  createBillingConcept,
  listBillingConcepts,
  upsertBillingSchedule,
  getBillingSchedule,
  listAvailableEndpoints,
  listModelsCatalog,
  getAttendancePolicy,
  upsertAttendancePolicy,
  buildCajaArequipaExport,
} from './admin.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

// Controladores para catálogos

export const getCampuses = asyncHandler(async (_req, res) => {
  const campuses = await listCampuses();
  res.json(campuses);
});

export const postCampus = asyncHandler(async (req, res) => {
  const campus = await createCampus(req.validated);
  res.status(201).json(campus);
});

export const getCycles = asyncHandler(async (_req, res) => {
  const cycles = await listCycles();
  res.json(cycles);
});

export const postCycle = asyncHandler(async (req, res) => {
  const cycle = await createCycle(req.validated);
  res.status(201).json(cycle);
});

export const getClassrooms = asyncHandler(async (_req, res) => {
  const classrooms = await listClassrooms();
  res.json(classrooms);
});

export const postClassroom = asyncHandler(async (req, res) => {
  const classroom = await createClassroom(req.validated);
  res.status(201).json(classroom);
});

export const getBillingConcepts = asyncHandler(async (_req, res) => {
  const concepts = await listBillingConcepts();
  res.json(concepts);
});

export const postBillingConcept = asyncHandler(async (req, res) => {
  const concept = await createBillingConcept(req.validated);
  res.status(201).json(concept);
});

export const getEndpointsCatalog = asyncHandler(async (req, res) => {
  const endpoints = await listAvailableEndpoints(req.app);
  res.json({ items: endpoints });
});

export const getModelsCatalog = asyncHandler(async (_req, res) => {
  const models = await listModelsCatalog();
  res.json({ items: models });
});

export const postBillingSchedule = asyncHandler(async (req, res) => {
  const rows = await upsertBillingSchedule(req.validated);
  res.status(201).json({
    cycleId: req.validated.cycleId,
    conceptCode: req.validated.conceptCode,
    items: rows.map((row) => ({
      monthIndex: row.monthIndex ?? null,
      label: row.label || '',
      dueDate: row.dueDate,
    })),
  });
});

export const getBillingScheduleByCycle = asyncHandler(async (req, res) => {
  const data = await getBillingSchedule(req.validatedQuery);
  res.json(data);
});

export const getAttendancePolicyConfig = asyncHandler(async (req, res) => {
  const data = await getAttendancePolicy(req.validatedQuery);
  res.json(data);
});

export const putAttendancePolicyConfig = asyncHandler(async (req, res) => {
  const data = await upsertAttendancePolicy(req.validated, req.user);
  res.json(data);
});

export const getCajaArequipaExport = asyncHandler(async (req, res) => {
  const result = await buildCajaArequipaExport({
    query: req.validatedQuery || {},
    user: req.user,
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
  res.setHeader('X-Export-Count', String(result.rowCount));
  res.send(result.content);
});
