import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  getAttendanceClassroomOptionsService,
  closeAttendanceSessionService,
  getAttendanceIntakeViewService,
  getRecentAttendanceJustificationsService,
  getClassroomDailyReportService,
  getClassroomMonthlySummaryService,
  getStudentMonthlySummaryService,
  justifyAttendanceRecordsBatchService,
  justifyAttendanceRecordService,
  openAttendanceSessionService,
  scanAttendanceByStudentCodeService,
  updateAttendanceSessionService,
} from './attendance.service.js';

export const openAttendanceSession = asyncHandler(async (req, res) => {
  const result = await openAttendanceSessionService(req.validated, req.user);
  res.status(result.meta.wasCreated ? 201 : 200).json(result);
});

export const getAttendanceClassroomOptions = asyncHandler(async (req, res) => {
  const result = await getAttendanceClassroomOptionsService(req.user);
  res.json(result);
});

export const getAttendanceIntakeView = asyncHandler(async (req, res) => {
  const result = await getAttendanceIntakeViewService({
    sessionId: req.validatedParams.sessionId,
    limit: req.validatedQuery?.limit,
    q: req.validatedQuery?.q,
  }, req.user);
  res.json(result);
});

export const updateAttendanceSession = asyncHandler(async (req, res) => {
  const result = await updateAttendanceSessionService({
    sessionId: req.validatedParams.sessionId,
    ...req.validated,
  }, req.user);
  res.json(result);
});

export const scanAttendanceByStudentCode = asyncHandler(async (req, res) => {
  const result = await scanAttendanceByStudentCodeService({
    sessionId: req.validatedParams.sessionId,
    ...req.validated,
  }, req.user);
  res.json(result);
});

export const closeAttendanceSession = asyncHandler(async (req, res) => {
  const result = await closeAttendanceSessionService({
    sessionId: req.validatedParams.sessionId,
    notes: req.validated?.notes,
  }, req.user);
  res.json(result);
});

export const justifyAttendanceRecord = asyncHandler(async (req, res) => {
  const result = await justifyAttendanceRecordService({
    recordId: req.validatedParams.recordId,
    justificationReason: req.validated.justificationReason,
  }, req.user);
  res.json(result);
});

export const justifyAttendanceRecordsBatch = asyncHandler(async (req, res) => {
  const result = await justifyAttendanceRecordsBatchService(req.validated, req.user);
  res.json(result);
});

export const getClassroomMonthlySummary = asyncHandler(async (req, res) => {
  const result = await getClassroomMonthlySummaryService({
    classroomId: req.validatedParams.classroomId,
    campusId: req.validatedQuery?.campusId,
    cycleId: req.validatedQuery?.cycleId,
    year: req.validatedQuery.year,
    month: req.validatedQuery.month,
  }, req.user);
  res.json(result);
});

export const getStudentMonthlySummary = asyncHandler(async (req, res) => {
  const result = await getStudentMonthlySummaryService({
    studentId: req.validatedParams.studentId,
    year: req.validatedQuery.year,
    month: req.validatedQuery.month,
  }, req.user);
  res.json(result);
});

export const getClassroomDailyReport = asyncHandler(async (req, res) => {
  const result = await getClassroomDailyReportService({
    classroomId: req.validatedParams.classroomId,
    date: req.validatedQuery.date,
  }, req.user);
  res.json(result);
});

export const getRecentAttendanceJustifications = asyncHandler(async (req, res) => {
  const result = await getRecentAttendanceJustificationsService({
    limit: req.validatedQuery?.limit,
  }, req.user);
  res.json(result);
});
