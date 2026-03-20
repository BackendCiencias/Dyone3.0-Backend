import test from 'node:test';
import assert from 'node:assert/strict';
import { updateAttendanceSessionService } from '../../src/modules/attendance/attendance.service.js';
import { AttendanceSession } from '../../src/models/attendanceSession.model.js';
import { Campus } from '../../src/models/campus.model.js';

function chain(value) {
  return {
    sort() { return this; },
    select() { return this; },
    limit() { return this; },
    lean: async () => value,
  };
}

test('updateAttendanceSessionService actualiza configuracion de una sesion existente', async (t) => {
  t.mock.method(AttendanceSession, 'findById', () => chain({
    _id: 'session-1',
    campusId: 'campus-1',
    cycleId: 'cycle-1',
    date: new Date('2026-03-19T00:00:00.000Z'),
    expectedStartTime: '07:30',
    onTimeUntil: '07:50',
    lateUntil: '09:00',
    status: 'OPEN',
    notes: 'Antes',
  }));
  t.mock.method(Campus, 'findById', () => chain({ code: 'NORTE' }));

  let updatePayload = null;
  t.mock.method(AttendanceSession, 'findByIdAndUpdate', async (_id, payload) => {
    updatePayload = payload;
    return {
      _id: 'session-1',
      campusId: 'campus-1',
      cycleId: 'cycle-1',
      date: new Date('2026-03-19T00:00:00.000Z'),
      expectedStartTime: '08:00',
      onTimeUntil: '08:15',
      lateUntil: '09:30',
      status: 'OPEN',
      takenByUserId: 'user-1',
      openedAt: new Date('2026-03-19T11:00:00.000Z'),
      closedAt: null,
      notes: 'Horario de invierno',
    };
  });

  const result = await updateAttendanceSessionService({
    sessionId: 'session-1',
    expectedStartTime: '08:00',
    onTimeUntil: '08:15',
    lateUntil: '09:30',
    notes: 'Horario de invierno',
  }, {
    id: 'user-1',
    roles: ['AUXILIAR'],
    campusScope: ['NORTE'],
  });

  assert.equal(result.session.id, 'session-1');
  assert.equal(result.session.expectedStartTime, '08:00');
  assert.equal(result.session.onTimeUntil, '08:15');
  assert.equal(result.session.lateUntil, '09:30');
  assert.equal(updatePayload.$set.expectedStartTime, '08:00');
  assert.equal(updatePayload.$set.onTimeUntil, '08:15');
  assert.equal(updatePayload.$set.notes, 'Horario de invierno');
});
