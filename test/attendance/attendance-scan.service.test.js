import test from 'node:test';
import assert from 'node:assert/strict';
import { scanAttendanceByStudentCodeService } from '../../src/modules/attendance/attendance.service.js';
import { AttendanceMonthlySummary } from '../../src/models/attendanceMonthlySummary.model.js';
import { AttendanceRecord } from '../../src/models/attendanceRecord.model.js';
import { AttendanceSession } from '../../src/models/attendanceSession.model.js';
import { Campus } from '../../src/models/campus.model.js';
import { Classroom } from '../../src/models/classroom.model.js';
import { Person } from '../../src/models/person.model.js';
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
    onTimeUntil: '07:50',
    lateUntil: '08:30',
    expectedStartTime: '07:30',
    status: 'OPEN',
    ...overrides,
  };
}

function mockCampusScope(t, campusCode = 'NORTE') {
  t.mock.method(Campus, 'findById', () => chain({ code: campusCode }));
}

function mockLatestRecordsEmpty(t) {
  t.mock.method(AttendanceRecord, 'find', () => chain([]));
}

test('scanAttendanceByStudentCodeService marca PRESENT cuando llega dentro del horario', async (t) => {
  mockCampusScope(t);
  t.mock.method(AttendanceSession, 'findById', () => chain(makeSession()));
  t.mock.method(Student, 'findOne', () => chain({
    _id: 'student-1',
    internalCode: 'A001',
    activeStatus: 'ACTIVE',
    personId: 'person-1',
  }));
  t.mock.method(StudentCycle, 'findOne', () => chain({
    _id: 'student-cycle-1',
    studentId: 'student-1',
    cycleId: 'cycle-1',
    campusId: 'campus-1',
    status: 'ACTIVE',
  }));
  t.mock.method(Student, 'findById', () => chain({
    _id: 'student-1',
    internalCode: 'A001',
    personId: 'person-1',
  }));
  t.mock.method(Vacancy, 'findOne', () => chain({ classroomId: 'classroom-1' }));
  t.mock.method(Person, 'findById', () => chain({
    _id: 'person-1',
    names: 'Ana',
    lastNames: 'Perez',
  }));
  t.mock.method(Classroom, 'findById', () => chain({
    _id: 'classroom-1',
    displayName: '1A',
  }));
  t.mock.method(AttendanceRecord, 'findOne', () => chain(null));

  let updatedPayload = null;
  t.mock.method(AttendanceRecord, 'findOneAndUpdate', async (_query, payload) => {
    updatedPayload = payload;
    return {
      _id: 'record-1',
      sessionId: 'session-1',
      studentId: 'student-1',
      status: payload.$set.status,
      arrivalTime: payload.$set.arrivalTime,
      markMethod: payload.$set.markMethod,
      markedAt: new Date('2026-03-19T12:01:00.000Z'),
      justificationStatus: 'NONE',
    };
  });

  const summaryUpdates = [];
  t.mock.method(AttendanceMonthlySummary, 'findOneAndUpdate', async (query, payload) => {
    summaryUpdates.push({ query, payload });
    return { acknowledged: true };
  });
  t.mock.method(AttendanceMonthlySummary, 'find', () => chain([
    {
      studentId: 'student-1',
      year: 2026,
      month: 3,
      presentCount: 1,
      lateCount: 0,
      absentCount: 0,
      justifiedLateCount: 0,
      justifiedAbsentCount: 0,
    },
  ]));
  mockLatestRecordsEmpty(t);

  const result = await scanAttendanceByStudentCodeService({
    sessionId: 'session-1',
    studentCode: 'A001',
    arrivalTime: '07:45',
    markMethod: 'BARCODE',
  }, {
    id: 'user-1',
    roles: ['AUXILIAR'],
    campusScope: ['NORTE'],
  });

  assert.equal(result.record.status, 'PRESENT');
  assert.equal(result.record.studentCode, 'A001');
  assert.equal(result.student.fullName, 'Perez, Ana');
  assert.equal(result.classroom?.displayName, '1A');
  assert.equal(result.monthlySummary.presentCount, 1);
  assert.equal(updatedPayload.$set.status, 'PRESENT');
  assert.equal(updatedPayload.$set.arrivalTime, '07:45');
  assert.equal(summaryUpdates.length, 1);
  assert.equal(summaryUpdates[0].payload.$inc.presentCount, 1);
});

test('scanAttendanceByStudentCodeService permite sesion CLOSED y corrige a LATE', async (t) => {
  mockCampusScope(t);
  t.mock.method(AttendanceSession, 'findById', () => chain(makeSession({ status: 'CLOSED' })));
  t.mock.method(Student, 'findOne', () => chain({
    _id: 'student-1',
    internalCode: 'A001',
    activeStatus: 'ACTIVE',
    personId: 'person-1',
  }));
  t.mock.method(StudentCycle, 'findOne', () => chain({
    _id: 'student-cycle-1',
    studentId: 'student-1',
    cycleId: 'cycle-1',
    campusId: 'campus-1',
    status: 'ACTIVE',
  }));
  t.mock.method(Student, 'findById', () => chain({
    _id: 'student-1',
    internalCode: 'A001',
    personId: 'person-1',
  }));
  t.mock.method(Vacancy, 'findOne', () => chain({ classroomId: 'classroom-1' }));
  t.mock.method(Person, 'findById', () => chain({
    _id: 'person-1',
    names: 'Ana',
    lastNames: 'Perez',
  }));
  t.mock.method(Classroom, 'findById', () => chain({
    _id: 'classroom-1',
    displayName: '1A',
  }));
  t.mock.method(AttendanceRecord, 'findOne', () => chain({
    _id: 'record-1',
    sessionId: 'session-1',
    studentId: 'student-1',
    status: 'ABSENT',
    justificationStatus: 'NONE',
  }));

  const summaryUpdates = [];
  t.mock.method(AttendanceRecord, 'findOneAndUpdate', async (_query, payload) => ({
    _id: 'record-1',
    sessionId: 'session-1',
    studentId: 'student-1',
    status: payload.$set.status,
    arrivalTime: payload.$set.arrivalTime,
    markMethod: payload.$set.markMethod,
    markedAt: new Date('2026-03-19T17:00:00.000Z'),
    justificationStatus: 'NONE',
  }));
  t.mock.method(AttendanceMonthlySummary, 'findOneAndUpdate', async (query, payload) => {
    summaryUpdates.push({ query, payload });
    return { acknowledged: true };
  });
  t.mock.method(AttendanceMonthlySummary, 'find', () => chain([
    {
      studentId: 'student-1',
      year: 2026,
      month: 3,
      presentCount: 0,
      lateCount: 1,
      absentCount: 0,
      justifiedLateCount: 0,
      justifiedAbsentCount: 0,
    },
  ]));
  mockLatestRecordsEmpty(t);

  const result = await scanAttendanceByStudentCodeService({
    sessionId: 'session-1',
    studentCode: 'A001',
    arrivalTime: '12:00',
    markMethod: 'MANUAL',
  }, {
    id: 'user-1',
    roles: ['AUXILIAR'],
    campusScope: ['NORTE'],
  });

  assert.equal(result.record.status, 'LATE');
  assert.equal(result.record.arrivalTime, '12:00');
  assert.equal(summaryUpdates.length, 2);
  assert.equal(summaryUpdates[0].payload.$inc.absentCount, -1);
  assert.equal(summaryUpdates[1].payload.$inc.lateCount, 1);
});

test('scanAttendanceByStudentCodeService rechaza un codigo no encontrado', async (t) => {
  mockCampusScope(t);
  t.mock.method(AttendanceSession, 'findById', () => chain(makeSession()));
  t.mock.method(Student, 'findOne', () => chain(null));

  await assert.rejects(
    scanAttendanceByStudentCodeService({
      sessionId: 'session-1',
      studentCode: 'NO-EXISTE',
      arrivalTime: '07:45',
      markMethod: 'BARCODE',
    }, {
      id: 'user-1',
      roles: ['AUXILIAR'],
      campusScope: ['NORTE'],
    }),
    (error) => error?.status === 404 && error?.code === 'ATTENDANCE_STUDENT_CODE_NOT_FOUND'
  );
});

test('scanAttendanceByStudentCodeService rechaza alumno de otro campus', async (t) => {
  mockCampusScope(t);
  t.mock.method(AttendanceSession, 'findById', () => chain(makeSession()));
  t.mock.method(Student, 'findOne', () => chain({
    _id: 'student-1',
    internalCode: 'A001',
    activeStatus: 'ACTIVE',
    personId: 'person-1',
  }));
  t.mock.method(StudentCycle, 'findOne', () => chain({
    _id: 'student-cycle-1',
    studentId: 'student-1',
    cycleId: 'cycle-1',
    campusId: 'campus-2',
    status: 'ACTIVE',
  }));

  await assert.rejects(
    scanAttendanceByStudentCodeService({
      sessionId: 'session-1',
      studentCode: 'A001',
      arrivalTime: '07:45',
      markMethod: 'BARCODE',
    }, {
      id: 'user-1',
      roles: ['AUXILIAR'],
      campusScope: ['NORTE'],
    }),
    (error) => error?.status === 409 && error?.code === 'ATTENDANCE_STUDENT_CAMPUS_MISMATCH'
  );
});

test('scanAttendanceByStudentCodeService rechaza doble registro cuando el alumno ya fue marcado', async (t) => {
  mockCampusScope(t);
  t.mock.method(AttendanceSession, 'findById', () => chain(makeSession()));
  t.mock.method(Student, 'findOne', () => chain({
    _id: 'student-1',
    internalCode: 'A001',
    activeStatus: 'ACTIVE',
    personId: 'person-1',
  }));
  t.mock.method(StudentCycle, 'findOne', () => chain({
    _id: 'student-cycle-1',
    studentId: 'student-1',
    cycleId: 'cycle-1',
    campusId: 'campus-1',
    status: 'ACTIVE',
  }));
  t.mock.method(Student, 'findById', () => chain({
    _id: 'student-1',
    internalCode: 'A001',
    personId: 'person-1',
  }));
  t.mock.method(Vacancy, 'findOne', () => chain({ classroomId: 'classroom-1' }));
  t.mock.method(Person, 'findById', () => chain({
    _id: 'person-1',
    names: 'Ana',
    lastNames: 'Perez',
  }));
  t.mock.method(Classroom, 'findById', () => chain({
    _id: 'classroom-1',
    displayName: '1A',
  }));
  t.mock.method(AttendanceRecord, 'findOne', () => chain({
    _id: 'record-1',
    sessionId: 'session-1',
    studentId: 'student-1',
    status: 'PRESENT',
    justificationStatus: 'NONE',
  }));

  await assert.rejects(
    scanAttendanceByStudentCodeService({
      sessionId: 'session-1',
      studentCode: 'A001',
      arrivalTime: '08:10',
      markMethod: 'BARCODE',
    }, {
      id: 'user-1',
      roles: ['AUXILIAR'],
      campusScope: ['NORTE'],
    }),
    (error) => error?.status === 409 && error?.code === 'ATTENDANCE_ALREADY_MARKED'
  );
});
