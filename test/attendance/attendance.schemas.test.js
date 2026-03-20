import test from 'node:test';
import assert from 'node:assert/strict';

import {
  attendanceClassroomMonthlySummaryParamsSchema,
  attendanceCloseSchema,
  attendanceIntakeViewQuerySchema,
  attendanceJustificationSchema,
  attendanceMonthlySummaryQuerySchema,
  attendanceRecordIdParamsSchema,
  attendanceScanSchema,
  attendanceSessionIdParamsSchema,
  attendanceSessionOpenSchema,
  attendanceStudentMonthlySummaryParamsSchema,
} from '../../src/modules/attendance/attendance.schemas.js';

const OBJECT_ID = '507f1f77bcf86cd799439011';

test('attendanceSessionOpenSchema acepta payload minimo y horario opcional', () => {
  const parsed = attendanceSessionOpenSchema.parse({
    campusId: OBJECT_ID,
    cycleId: '507f1f77bcf86cd799439012',
    date: '2026-03-19',
    expectedStartTime: '07:50',
    onTimeUntil: '08:00',
    lateUntil: '08:15',
  });

  assert.equal(parsed.campusId, OBJECT_ID);
  assert.equal(parsed.date, '2026-03-19');
  assert.equal(parsed.onTimeUntil, '08:00');
});

test('attendanceSessionOpenSchema rechaza fecha invalida', () => {
  assert.throws(() => attendanceSessionOpenSchema.parse({
    campusId: OBJECT_ID,
    cycleId: '507f1f77bcf86cd799439012',
    date: '19-03-2026',
  }));
});

test('attendanceScanSchema acepta studentCode y markMethod', () => {
  const parsed = attendanceScanSchema.parse({
    studentCode: 'A001245',
    arrivalTime: '07:42',
    markMethod: 'BARCODE',
  });

  assert.equal(parsed.studentCode, 'A001245');
  assert.equal(parsed.markMethod, 'BARCODE');
});

test('attendanceScanSchema rechaza studentCode vacio', () => {
  assert.throws(() => attendanceScanSchema.parse({
    studentCode: '',
    markMethod: 'MANUAL',
  }));
});

test('attendanceScanSchema rechaza markMethod fuera de enum', () => {
  assert.throws(() => attendanceScanSchema.parse({
    studentCode: 'A001245',
    markMethod: 'QR',
  }));
});

test('attendanceJustificationSchema exige motivo minimo', () => {
  const parsed = attendanceJustificationSchema.parse({
    justificationReason: 'Presento constancia medica',
  });

  assert.equal(parsed.justificationReason, 'Presento constancia medica');
  assert.throws(() => attendanceJustificationSchema.parse({ justificationReason: 'ok' }));
});

test('attendanceMonthlySummaryQuerySchema valida month y year', () => {
  const parsed = attendanceMonthlySummaryQuerySchema.parse({
    year: '2026',
    month: '3',
  });

  assert.equal(parsed.year, 2026);
  assert.equal(parsed.month, 3);
  assert.throws(() => attendanceMonthlySummaryQuerySchema.parse({ year: 2026, month: 13 }));
});

test('schemas de params aceptan ObjectId valido', () => {
  assert.equal(attendanceSessionIdParamsSchema.parse({ sessionId: OBJECT_ID }).sessionId, OBJECT_ID);
  assert.equal(attendanceRecordIdParamsSchema.parse({ recordId: OBJECT_ID }).recordId, OBJECT_ID);
  assert.equal(attendanceClassroomMonthlySummaryParamsSchema.parse({ classroomId: OBJECT_ID }).classroomId, OBJECT_ID);
  assert.equal(attendanceStudentMonthlySummaryParamsSchema.parse({ studentId: OBJECT_ID }).studentId, OBJECT_ID);
});

test('attendanceIntakeViewQuerySchema limita el numero de ultimos tomados', () => {
  const parsed = attendanceIntakeViewQuerySchema.parse({ limit: '10', q: 'perez a001' });
  assert.equal(parsed.limit, 10);
  assert.equal(parsed.q, 'perez a001');
  assert.throws(() => attendanceIntakeViewQuerySchema.parse({ limit: 50 }));
});

test('attendanceCloseSchema acepta notes opcional', () => {
  const parsed = attendanceCloseSchema.parse({ notes: 'Sesion cerrada por auxiliar' });
  assert.equal(parsed.notes, 'Sesion cerrada por auxiliar');
  assert.deepEqual(attendanceCloseSchema.parse({}), {});
});
