import test from 'node:test';
import assert from 'node:assert/strict';
import { openAttendanceSessionService } from '../../src/modules/attendance/attendance.service.js';
import { AttendancePolicy } from '../../src/models/attendancePolicy.model.js';
import { AttendanceSession } from '../../src/models/attendanceSession.model.js';
import { Campus } from '../../src/models/campus.model.js';
import { Cycle } from '../../src/models/cycle.model.js';

function chain(value) {
  return {
    sort() { return this; },
    select() { return this; },
    limit() { return this; },
    lean: async () => value,
  };
}

function makeCreatedSession(overrides = {}) {
  const base = {
    _id: 'session-1',
    scopeType: 'REGULAR_STUDENT',
    campusId: 'campus-1',
    cycleId: 'cycle-1',
    date: new Date('2026-03-19T00:00:00.000Z'),
    expectedStartTime: '07:30',
    onTimeUntil: '07:50',
    lateUntil: '08:30',
    status: 'OPEN',
    attendancePolicyId: 'policy-1',
    takenByUserId: 'user-1',
    openedAt: new Date('2026-03-19T12:00:00.000Z'),
    closedAt: null,
    notes: null,
    ...overrides,
  };

  return {
    toObject() {
      return base;
    },
  };
}

test('openAttendanceSessionService crea una sesion nueva cuando no existe', async (t) => {
  t.mock.method(Campus, 'findById', () => chain({ code: 'NORTE' }));
  t.mock.method(Cycle, 'findById', () => chain({ _id: 'cycle-1' }));
  t.mock.method(AttendanceSession, 'findOne', () => chain(null));
  t.mock.method(AttendancePolicy, 'find', () => chain([]));

  let createdPayload = null;
  t.mock.method(AttendanceSession, 'create', async (payload) => {
    createdPayload = payload;
    return makeCreatedSession(payload);
  });

  const result = await openAttendanceSessionService({
    campusId: 'campus-1',
    cycleId: 'cycle-1',
    date: '2026-03-19',
    expectedStartTime: '07:30',
    onTimeUntil: '07:50',
    lateUntil: '08:30',
    notes: 'Ingreso regular',
  }, {
    id: 'user-1',
    roles: ['AUXILIAR'],
    campusScope: ['NORTE'],
  });

  assert.equal(result.meta.wasCreated, true);
  assert.equal(result.meta.policyResolved, false);
  assert.equal(result.session.id, 'session-1');
  assert.equal(result.session.status, 'OPEN');
  assert.equal(result.session.date, '2026-03-19');
  assert.equal(createdPayload.scopeType, 'REGULAR_STUDENT');
  assert.equal(createdPayload.campusId, 'campus-1');
  assert.equal(createdPayload.cycleId, 'cycle-1');
  assert.equal(createdPayload.expectedStartTime, '07:30');
  assert.equal(createdPayload.onTimeUntil, '07:50');
  assert.equal(createdPayload.lateUntil, '08:30');
  assert.equal(createdPayload.takenByUserId, 'user-1');
});

test('openAttendanceSessionService retorna la sesion existente de forma idempotente', async (t) => {
  t.mock.method(Campus, 'findById', () => chain({ code: 'NORTE' }));
  t.mock.method(Cycle, 'findById', () => chain({ _id: 'cycle-1' }));
  t.mock.method(AttendanceSession, 'findOne', () => chain({
    _id: 'session-existing',
    scopeType: 'REGULAR_STUDENT',
    campusId: 'campus-1',
    cycleId: 'cycle-1',
    date: new Date('2026-03-19T00:00:00.000Z'),
    expectedStartTime: '07:30',
    onTimeUntil: '07:50',
    lateUntil: '08:30',
    status: 'OPEN',
    attendancePolicyId: 'policy-1',
    takenByUserId: 'user-1',
    openedAt: new Date('2026-03-19T12:00:00.000Z'),
    closedAt: null,
    notes: 'Existente',
  }));

  const createMock = t.mock.method(AttendanceSession, 'create', async () => {
    throw new Error('No deberia crear una nueva sesion');
  });

  const result = await openAttendanceSessionService({
    campusId: 'campus-1',
    cycleId: 'cycle-1',
    date: '2026-03-19',
    expectedStartTime: '07:30',
    onTimeUntil: '07:50',
  }, {
    id: 'user-1',
    roles: ['AUXILIAR'],
    campusScope: ['NORTE'],
  });

  assert.equal(result.meta.wasCreated, false);
  assert.equal(result.meta.policyResolved, true);
  assert.equal(result.session.id, 'session-existing');
  assert.equal(createMock.mock.calls.length, 0);
});

test('openAttendanceSessionService usa la politica activa cuando no llegan horarios en el payload', async (t) => {
  t.mock.method(Campus, 'findById', () => chain({ code: 'NORTE' }));
  t.mock.method(Cycle, 'findById', () => chain({ _id: 'cycle-1' }));
  t.mock.method(AttendanceSession, 'findOne', () => chain(null));
  t.mock.method(AttendancePolicy, 'find', () => chain([{
    _id: 'policy-1',
    defaultOnTimeUntil: '08:15',
  }]));

  let createdPayload = null;
  t.mock.method(AttendanceSession, 'create', async (payload) => {
    createdPayload = payload;
    return makeCreatedSession(payload);
  });

  const result = await openAttendanceSessionService({
    campusId: 'campus-1',
    cycleId: 'cycle-1',
    date: '2026-06-20',
  }, {
    id: 'user-1',
    roles: ['AUXILIAR'],
    campusScope: ['NORTE'],
  });

  assert.equal(result.meta.wasCreated, true);
  assert.equal(result.meta.policyResolved, true);
  assert.equal(createdPayload.expectedStartTime, '08:15');
  assert.equal(createdPayload.onTimeUntil, '08:15');
  assert.equal(createdPayload.lateUntil, null);
  assert.equal(String(createdPayload.attendancePolicyId), 'policy-1');
});

test('openAttendanceSessionService rechaza auxiliares fuera del campusScope', async (t) => {
  t.mock.method(Campus, 'findById', () => chain({ code: 'SUR' }));

  await assert.rejects(
    openAttendanceSessionService({
      campusId: 'campus-2',
      cycleId: 'cycle-1',
      date: '2026-03-19',
      expectedStartTime: '07:30',
      onTimeUntil: '07:50',
    }, {
      id: 'user-1',
      roles: ['AUXILIAR'],
      campusScope: ['NORTE'],
    }),
    (error) => error?.status === 403 && error?.code === 'ATTENDANCE_CAMPUS_FORBIDDEN'
  );
});
