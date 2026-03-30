import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/roles.js';
import { validateRequest } from '../../middlewares/validateRequest.js';
import { attachCampusScope } from '../../shared/authorization.middleware.js';
import {
  attendanceBatchJustificationSchema,
  attendanceClassroomMonthlySummaryParamsSchema,
  attendanceCloseSchema,
  attendanceDailyReportQuerySchema,
  attendanceIntakeViewQuerySchema,
  attendanceJustificationSchema,
  attendanceMonthlySummaryQuerySchema,
  attendanceRecordIdParamsSchema,
  attendanceRecentJustificationsQuerySchema,
  attendanceScanSchema,
  attendanceSessionIdParamsSchema,
  attendanceSessionCurrentQuerySchema,
  attendanceSessionOpenSchema,
  attendanceSessionUpdateSchema,
  attendanceStudentMonthlySummaryParamsSchema,
} from './attendance.schemas.js';
import {
  closeAttendanceSession,
  getCurrentAttendanceSession,
  getAttendanceClassroomOptions,
  getAttendanceIntakeView,
  getClassroomDailyReport,
  getClassroomMonthlySummary,
  getRecentAttendanceJustifications,
  getStudentMonthlySummary,
  justifyAttendanceRecordsBatch,
  justifyAttendanceRecord,
  openAttendanceSession,
  scanAttendanceByStudentCode,
  updateAttendanceSession,
} from './attendance.controller.js';

const router = Router();

router.use(authMiddleware);
router.use(requireRoles(['AUXILIAR']));
router.use(attachCampusScope());

router.get('/classrooms/options', getAttendanceClassroomOptions);
router.get('/sessions/current', validateRequest({ query: attendanceSessionCurrentQuerySchema }), getCurrentAttendanceSession);
router.post('/sessions/open', validateRequest({ body: attendanceSessionOpenSchema }), openAttendanceSession);
router.get('/sessions/:sessionId/intake-view', validateRequest({ params: attendanceSessionIdParamsSchema, query: attendanceIntakeViewQuerySchema }), getAttendanceIntakeView);
router.patch('/sessions/:sessionId', validateRequest({ params: attendanceSessionIdParamsSchema, body: attendanceSessionUpdateSchema }), updateAttendanceSession);
router.post('/sessions/:sessionId/scan', validateRequest({ params: attendanceSessionIdParamsSchema, body: attendanceScanSchema }), scanAttendanceByStudentCode);
router.post('/sessions/:sessionId/close', validateRequest({ params: attendanceSessionIdParamsSchema, body: attendanceCloseSchema }), closeAttendanceSession);
router.get('/justifications/recent', validateRequest({ query: attendanceRecentJustificationsQuerySchema }), getRecentAttendanceJustifications);
router.patch('/records/justification-batch', validateRequest({ body: attendanceBatchJustificationSchema }), justifyAttendanceRecordsBatch);
router.patch('/records/:recordId/justification', validateRequest({ params: attendanceRecordIdParamsSchema, body: attendanceJustificationSchema }), justifyAttendanceRecord);
router.get('/classrooms/:classroomId/daily-report', validateRequest({ params: attendanceClassroomMonthlySummaryParamsSchema, query: attendanceDailyReportQuerySchema }), getClassroomDailyReport);
router.get('/classrooms/:classroomId/monthly-summary', validateRequest({ params: attendanceClassroomMonthlySummaryParamsSchema, query: attendanceMonthlySummaryQuerySchema }), getClassroomMonthlySummary);
router.get('/students/:studentId/monthly-summary', validateRequest({ params: attendanceStudentMonthlySummaryParamsSchema, query: attendanceMonthlySummaryQuerySchema }), getStudentMonthlySummary);

export default router;
