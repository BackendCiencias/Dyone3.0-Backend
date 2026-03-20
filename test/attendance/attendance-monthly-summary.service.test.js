import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getClassroomMonthlySummaryService,
  getStudentMonthlySummaryService,
} from '../../src/modules/attendance/attendance.service.js';
import { AttendanceMonthlySummary } from '../../src/models/attendanceMonthlySummary.model.js';
import { Campus } from '../../src/models/campus.model.js';
import { Classroom } from '../../src/models/classroom.model.js';
import { Person } from '../../src/models/person.model.js';
import { Student } from '../../src/models/student.model.js';
import { StudentCycle } from '../../src/models/studentCycle.model.js';

function chain(value) {
  return {
    sort() { return this; },
    select() { return this; },
    limit() { return this; },
    lean: async () => value,
  };
}

test('getClassroomMonthlySummaryService retorna items del salon y valida campus', async (t) => {
  t.mock.method(Classroom, 'findById', () => chain({
    _id: 'classroom-1',
    displayName: '1A',
    campusId: 'campus-1',
    cycleId: 'cycle-1',
  }));
  t.mock.method(Campus, 'findById', () => chain({ code: 'NORTE' }));
  t.mock.method(AttendanceMonthlySummary, 'find', () => chain([
    {
      studentId: 'student-1',
      lateCount: 2,
      absentCount: 1,
      justifiedLateCount: 1,
      justifiedAbsentCount: 0,
    },
  ]));
  t.mock.method(Student, 'find', () => chain([
    { _id: 'student-1', personId: 'person-1' },
  ]));
  t.mock.method(Person, 'find', () => chain([
    { _id: 'person-1', names: 'Ana', lastNames: 'Perez' },
  ]));

  const result = await getClassroomMonthlySummaryService({
    classroomId: 'classroom-1',
    year: 2026,
    month: 3,
  }, {
    roles: ['AUXILIAR'],
    campusScope: ['NORTE'],
  });

  assert.equal(result.classroom.id, 'classroom-1');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].person.fullName, 'Perez, Ana');
  assert.equal(result.items[0].summary.lateCount, 2);
  assert.equal(result.meta.total, 1);
});

test('getStudentMonthlySummaryService suma multiples summaries del mes', async (t) => {
  t.mock.method(Student, 'findById', () => chain({
    _id: 'student-1',
    personId: 'person-1',
  }));
  t.mock.method(StudentCycle, 'findOne', () => chain({
    studentId: 'student-1',
    campusId: 'campus-1',
  }));
  t.mock.method(Campus, 'findById', () => chain({ code: 'NORTE' }));
  t.mock.method(AttendanceMonthlySummary, 'find', () => chain([
    {
      presentCount: 10,
      lateCount: 1,
      absentCount: 0,
      justifiedLateCount: 1,
      justifiedAbsentCount: 0,
    },
    {
      presentCount: 5,
      lateCount: 2,
      absentCount: 1,
      justifiedLateCount: 0,
      justifiedAbsentCount: 1,
    },
  ]));
  t.mock.method(Person, 'findById', () => chain({
    _id: 'person-1',
    names: 'Ana',
    lastNames: 'Perez',
  }));

  const result = await getStudentMonthlySummaryService({
    studentId: 'student-1',
    year: 2026,
    month: 3,
  }, {
    roles: ['AUXILIAR'],
    campusScope: ['NORTE'],
  });

  assert.equal(result.student.id, 'student-1');
  assert.equal(result.student.fullName, 'Perez, Ana');
  assert.equal(result.summary.presentCount, 15);
  assert.equal(result.summary.lateCount, 3);
  assert.equal(result.summary.absentCount, 1);
  assert.equal(result.summary.justifiedLateCount, 1);
  assert.equal(result.summary.justifiedAbsentCount, 1);
});
