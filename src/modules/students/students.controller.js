import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  createStudentService,
  searchStudentAutocompleteService,
  searchStudentsService,
  getStudentSummaryService,
  listStudentsByCampusService,
  getStudentDetailService,
  changeStudentClassroomService,
  getStudentAccountStatementService,
  getStudentChargesService,
  getStudentPaymentsService,
  updateStudentIdentityService,
  updateStudentInternalNotesService,
  updateStudentBankCodeService,
  searchUnassignedStudentsService,
  searchUnassignedStudentsByQueryService,
  getStudentsPrintCardsService,
} from './students.service.js';

const ENABLE_STUDENTS_BY_CAMPUS_DEBUG =
  process.env.STUDENTS_BY_CAMPUS_DEBUG === 'true' || process.env.NODE_ENV !== 'production';

export const createStudent = asyncHandler(async (req, res) => {
  const result = await createStudentService(req.validated);
  res.status(201).json(result.student);
});

export const createStudentIntake = asyncHandler(async (req, res) => {
  const result = await createStudentService(req.validated.student, req.validated.tutorBundle);
  res.status(201).json(result);
});

export const searchStudent = asyncHandler(async (req, res) => {
  const students = await searchStudentAutocompleteService(req.validatedQuery || req.query);
  res.json(students);
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
    campusScope: req.user?.campusScope || [],
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


export const updateStudentBankCode = asyncHandler(async (req, res) => {
  const data = await updateStudentBankCodeService(
    req.validatedParams.id,
    req.validated.bankCode,
    req.user?.id
  );
  res.json(data);
});

export const listUnassignedStudents = asyncHandler(async (req, res) => {
  const data = await searchUnassignedStudentsService(req.validatedQuery || req.query);
  res.json(data);
});

export const searchUnassigned = asyncHandler(async (req, res) => {
  const data = await searchUnassignedStudentsByQueryService(req.validatedQuery || req.query);
  res.json(data);
});

export const printStudentCards = asyncHandler(async (req, res) => {
  const data = await getStudentsPrintCardsService(req.validated);
  res.json(data);
});
