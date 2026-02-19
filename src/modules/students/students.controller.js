import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  createStudentService,
  findStudentByDniService,
  searchStudentsService,
  getStudentSummaryService,
  listStudentsByCampusService,
  getStudentDetailService,
  updateStudentCycleStatusService,
  changeStudentClassroomService,
  getStudentAccountStatementService,
  getStudentChargesService,
  getStudentPaymentsService,
  updateStudentIdentityService,
  updateStudentInternalNotesService,
} from './students.service.js';

const ENABLE_STUDENTS_BY_CAMPUS_DEBUG =
  process.env.STUDENTS_BY_CAMPUS_DEBUG === 'true' || process.env.NODE_ENV !== 'production';

export const createStudent = asyncHandler(async (req, res) => {
  const student = await createStudentService(req.validated);
  res.status(201).json(student);
});

export const createStudentWithPerson = asyncHandler(async (req, res) => {
  const student = await createStudentService(req.validated);
  res.status(201).json({
    studentId: student._id,
    student,
  });
});

export const searchStudent = asyncHandler(async (req, res) => {
  const { dni } = req.query;
  if (!dni) {
    return res.status(400).json({ message: 'DNI requerido' });
  }
  const student = await findStudentByDniService(dni);
  if (!student) {
    return res.status(404).json({ message: 'Estudiante no encontrado' });
  }
  res.json(student);
});

export const listStudents = asyncHandler(async (req, res) => {
  const data = await searchStudentsService(req.query);
  res.json(data);
});

export const listStudentsByCampus = asyncHandler(async (req, res) => {
  const { campus } = req.params;
  const { q, limit, cursor } = req.query;

  if (ENABLE_STUDENTS_BY_CAMPUS_DEBUG) {
    console.log('[studentsByCampus] campus=', campus, 'q=', q, 'limit=', limit, 'cursor=', cursor);
  }

  const data = await listStudentsByCampusService({
    campus,
    roles: req.user?.roles || [],
    q,
    limit,
    cursor,
  });

  if (ENABLE_STUDENTS_BY_CAMPUS_DEBUG) {
    console.log('[studentsByCampus] items=', data.items.length, 'nextCursor=', data.nextCursor);
  }

  res.json(data);
});

export const studentSummary = asyncHandler(async (req, res) => {
  const data = await getStudentSummaryService(req.params.id);
  res.json(data);
});

export const getStudentDetail = asyncHandler(async (req, res) => {
  const data = await getStudentDetailService(req.validatedParams.id, req.validatedQuery?.cycleId);
  res.json(data);
});

export const updateStudentCycleStatus = asyncHandler(async (req, res) => {
  const data = await updateStudentCycleStatusService(req.validatedParams.id, req.validated, req.user.id);
  res.json(data);
});

export const changeStudentClassroom = asyncHandler(async (req, res) => {
  const data = await changeStudentClassroomService(req.validatedParams.id, req.validated, req.user.id);
  res.json(data);
});

export const getStudentAccountStatement = asyncHandler(async (req, res) => {
  const data = await getStudentAccountStatementService(req.validatedParams.studentId);
  res.json(data);
});

export const getStudentCharges = asyncHandler(async (req, res) => {
  const data = await getStudentChargesService(req.validatedParams.studentId);
  res.json(data);
});

export const getStudentPayments = asyncHandler(async (req, res) => {
  const data = await getStudentPaymentsService(req.validatedParams.studentId);
  res.json(data);
});

export const updateStudentIdentity = asyncHandler(async (req, res) => {
  const data = await updateStudentIdentityService(req.validatedParams.id, req.validated, req.user?.id);
  res.json(data);
});

export const updateStudentInternalNotes = asyncHandler(async (req, res) => {
  const data = await updateStudentInternalNotesService(
    req.validatedParams.id,
    req.validated.internalNotes,
    req.user?.id
  );
  res.json(data);
});
