import test from 'node:test';
import assert from 'node:assert/strict';
import { closeAttendanceSessionService } from '../../src/modules/attendance/attendance.service.js';
import { AttendanceMonthlySummary } from '../../src/models/attendanceMonthlySummary.model.js';
import { AttendanceRecord } from '../../src/models/attendanceRecord.model.js';
import { AttendanceSession } from '../../src/models/attendanceSession.model.js';
import { Campus } from '../../src/models/campus.model.js';
import { Student } from '../../src/models/student.model.js';
import { StudentCycle } from '../../src/models/studentCycle.model.js';
import { Vacancy } from '../../src/models/vacancy.model.js';

function chain(value) {
  return {
    sort() { return this; },
    select() { return this; },
    limit() { return this; },
    lean: async () => value,
  };
}

function makeSession(overrides = {}) {
  return {
    _id: 'session-1',
    campusId: 'campus-1',
    cycleId: 'cycle-1',
    date: new Date('2026-03-19T00:00:00.000Z'),
    status: 'OPEN',
    notes: null,
    ...overrides,
  };
}

test('closeAttendanceSessionService consolida ausentes y cierra la sesion', async (t) => {
  t.mock.method(AttendanceSession, 'findById', () => chain(makeSession()));
  t.mock.method(Campus, 'findById', () => chain({ code: 'NORTE' }));
  t.mock.method(StudentCycle, 'find', () => chain([
    { _id: 'sc-1', studentId: 'student-1' },
    { _id: 'sc-2', studentId: 'student-2' },
  ]));
  t.mock.method(Student, 'find', () => chain([
    { _id: 'student-1' },
    { _id: 'student-2' },
  ]));
  t.mock.method(AttendanceRecord, 'find', () => chain([
    { studentId: 'student-1' },
  ]));
  t.mock.method(Vacancy, 'findOne', () => chain({ classroomId: 'classroom-1' }));

  let createdAbsent = null;
  t.mock.method(AttendanceRecord, 'create', async (payload) => {
    createdAbsent = payload;
    return {
      _id: 'record-absent-1',
      studentId: payload.studentId,
      status: payload.status,
      justificationStatus: payload.justificationStatus,
    };
  });

  const summaryUpdates = [];
  t.mock.method(AttendanceMonthlySummary, 'findOneAndUpdate', async (_query, payload) => {
    summaryUpdates.push(payload);
    return { acknowledged: true };
  });

  let updatePayload = null;
  t.mock.method(AttendanceSession, 'findByIdAndUpdate', async (_id, payload) => {
    updatePayload = payload;
    return {
      _id: 'session-1',
      status: 'CLOSED',
      closedAt: new Date('2026-03-19T15:00:00.000Z'),
    };
  });

  const result = await closeAttendanceSessionService({
    sessionId: 'session-1',
    notes: 'Cierre operativo',
  }, {
    id: 'user-1',
    roles: ['AUXILIAR'],
    campusScope: ['NORTE'],
  });

  assert.equal(result.session.id, 'session-1');
  assert.equal(result.session.status, 'CLOSED');
  assert.equal(createdAbsent.studentId, 'student-2');
  assert.equal(createdAbsent.status, 'ABSENT');
  assert.equal(createdAbsent.markMethod, 'BULK');
  assert.equal(summaryUpdates.length, 1);
  assert.equal(summaryUpdates[0].$inc.absentCount, 1);
  assert.equal(updatePayload.$set.status, 'CLOSED');
  assert.equal(updatePayload.$set.notes, 'Cierre operativo');
});

test('closeAttendanceSessionService rechaza sesiones canceladas', async (t) => {
  t.mock.method(AttendanceSession, 'findById', () => chain(makeSession({ status: 'CANCELLED' })));

  await assert.rejects(
    closeAttendanceSessionService({
      sessionId: 'session-1',
      notes: 'No deberia cerrar',
    }, {
      id: 'user-1',
      roles: ['AUXILIAR'],
      campusScope: ['NORTE'],
    }),
    (error) => error?.status === 409 && error?.code === 'ATTENDANCE_SESSION_CANCELLED'
  );
});
