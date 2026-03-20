import test from 'node:test';
import assert from 'node:assert/strict';
import { justifyAttendanceRecordService } from '../../src/modules/attendance/attendance.service.js';
import { AttendanceMonthlySummary } from '../../src/models/attendanceMonthlySummary.model.js';
import { AttendanceRecord } from '../../src/models/attendanceRecord.model.js';
import { AttendanceSession } from '../../src/models/attendanceSession.model.js';
import { Campus } from '../../src/models/campus.model.js';
import { Vacancy } from '../../src/models/vacancy.model.js';

function chain(value) {
  return {
    sort() { return this; },
    select() { return this; },
    limit() { return this; },
    lean: async () => value,
  };
}

test('justifyAttendanceRecordService justifica una tardanza y ajusta summary', async (t) => {
  t.mock.method(AttendanceRecord, 'findById', () => chain({
    _id: 'record-1',
    sessionId: 'session-1',
    studentId: 'student-1',
    status: 'LATE',
    justificationStatus: 'NONE',
  }));
  t.mock.method(AttendanceSession, 'findById', () => chain({
    _id: 'session-1',
    campusId: 'campus-1',
    cycleId: 'cycle-1',
    date: new Date('2026-03-19T00:00:00.000Z'),
  }));
  t.mock.method(Campus, 'findById', () => chain({ code: 'NORTE' }));
  t.mock.method(Vacancy, 'findOne', () => chain({ classroomId: 'classroom-1' }));

  let updatePayload = null;
  t.mock.method(AttendanceRecord, 'findByIdAndUpdate', async (_id, payload) => {
    updatePayload = payload;
    return {
      _id: 'record-1',
      studentId: 'student-1',
      status: 'LATE',
      justificationStatus: 'JUSTIFIED',
      justificationReason: payload.$set.justificationReason,
      justifiedAt: new Date('2026-03-20T10:00:00.000Z'),
      justifiedByUserId: payload.$set.justifiedByUserId,
    };
  });

  const summaryUpdates = [];
  t.mock.method(AttendanceMonthlySummary, 'findOneAndUpdate', async (_query, payload) => {
    summaryUpdates.push(payload);
    return { acknowledged: true };
  });

  const result = await justifyAttendanceRecordService({
    recordId: 'record-1',
    justificationReason: 'El padre informo demora por cita medica',
  }, {
    id: 'user-1',
    roles: ['AUXILIAR'],
    campusScope: ['NORTE'],
  });

  assert.equal(result.record.id, 'record-1');
  assert.equal(result.record.status, 'LATE');
  assert.equal(result.record.justificationStatus, 'JUSTIFIED');
  assert.equal(updatePayload.$set.justificationType, 'LATE');
  assert.equal(summaryUpdates.length, 2);
  assert.ok(Object.is(summaryUpdates[0].$inc.justifiedLateCount, -0) || summaryUpdates[0].$inc.justifiedLateCount === 0);
  assert.equal(summaryUpdates[1].$inc.justifiedLateCount, 1);
});

test('justifyAttendanceRecordService rechaza registros PRESENT', async (t) => {
  t.mock.method(AttendanceRecord, 'findById', () => chain({
    _id: 'record-1',
    sessionId: 'session-1',
    studentId: 'student-1',
    status: 'PRESENT',
    justificationStatus: 'NONE',
  }));
  t.mock.method(AttendanceSession, 'findById', () => chain({
    _id: 'session-1',
    campusId: 'campus-1',
    cycleId: 'cycle-1',
    date: new Date('2026-03-19T00:00:00.000Z'),
  }));
  t.mock.method(Campus, 'findById', () => chain({ code: 'NORTE' }));

  await assert.rejects(
    justifyAttendanceRecordService({
      recordId: 'record-1',
      justificationReason: 'No aplica',
    }, {
      id: 'user-1',
      roles: ['AUXILIAR'],
      campusScope: ['NORTE'],
    }),
    (error) => error?.status === 409 && error?.code === 'ATTENDANCE_JUSTIFICATION_NOT_ALLOWED'
  );
});
