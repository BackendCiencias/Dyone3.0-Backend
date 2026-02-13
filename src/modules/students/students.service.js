import mongoose from 'mongoose';
import { Person } from '../../models/person.model.js';
import { Student } from '../../models/student.model.js';
import { Family } from '../../models/family.model.js';
import { Counter } from '../../models/counter.model.js';
import { Classroom } from '../../models/classroom.model.js';
import { Cycle } from '../../models/cycle.model.js';
import { StudentCycle } from '../../models/studentCycle.model.js';
import { Vacancy } from '../../models/vacancy.model.js';
import { ApiError } from '../../utils/errors.js';

function normalizeDni(dni) {
  const normalized = String(dni || '').trim();
  if (!normalized) return undefined;
  const lowered = normalized.toLowerCase();
  if (['null', 'undefined', 'n/a', 'na', '-'].includes(lowered)) return undefined;
  return normalized;
}

async function nextStudentCode(session) {
  const counter = await Counter.findOneAndUpdate(
    { key: 'student_internal_code' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session }
  );

  return `COD_A${String(counter.seq).padStart(5, '0')}`;
}

async function resolveCurrentCycle(session) {
  const now = new Date();
  const cycle = await Cycle.findOne({
    type: 'SCHOOL_YEAR',
    isActive: true,
    startDate: { $lte: now },
    endDate: { $gte: now },
  })
    .sort({ startDate: -1 })
    .session(session);

  if (cycle) return cycle;

  const fallback = await Cycle.findOne({ type: 'SCHOOL_YEAR', isActive: true })
    .sort({ startDate: -1 })
    .session(session);

  if (!fallback) {
    throw new ApiError(400, 'No hay ciclo escolar activo para crear StudentCycle');
  }

  return fallback;
}

async function resolveOrCreatePerson(person, session) {
  const dni = normalizeDni(person.dni);

  let personDoc = null;
  if (dni) {
    personDoc = await Person.findOne({ dni }).session(session);
  }

  if (!personDoc) {
    personDoc = new Person({
      ...person,
      ...(dni ? { dni } : {}),
      ...(dni ? {} : { dni: undefined }),
    });
    await personDoc.save({ session });
    return personDoc;
  }

  const setUpdates = {};
  if (person.names && personDoc.names !== person.names) setUpdates.names = person.names;
  if (person.lastNames && personDoc.lastNames !== person.lastNames) setUpdates.lastNames = person.lastNames;
  if (person.gender && personDoc.gender !== person.gender) setUpdates.gender = person.gender;
  if (person.phone && personDoc.phone !== person.phone) setUpdates.phone = person.phone;
  if (person.address && personDoc.address !== person.address) setUpdates.address = person.address;
  if (person.email && personDoc.email !== person.email) setUpdates.email = person.email;

  if (Object.keys(setUpdates).length) {
    await Person.updateOne({ _id: personDoc._id }, { $set: setUpdates }, { session });
  }

  return personDoc;
}

export async function createStudentService({ person, familyId, classroomId, entryDate, notes }) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const classroom = await Classroom.findById(classroomId).session(session);
    if (!classroom) {
      throw new ApiError(404, 'Classroom no encontrado');
    }

    const personDoc = await resolveOrCreatePerson(person, session);

    let family = null;
    if (familyId) {
      family = await Family.findById(familyId).session(session);
      if (!family) throw new ApiError(404, 'Familia no encontrada');
    } else {
      family = new Family({ tutorIds: [], studentIds: [], notes: 'Stub creado desde POST /api/students' });
      await family.save({ session });
    }

    const existingStudent = await Student.findOne({ personId: personDoc._id }).session(session);
    if (existingStudent) {
      throw new ApiError(409, 'Ya existe un alumno para esta persona');
    }

    const internalCode = await nextStudentCode(session);

    const student = await Student.create([
      {
        personId: personDoc._id,
        familyId: family._id,
        internalCode,
        entryDate: entryDate ? new Date(entryDate) : undefined,
        notes,
      },
    ], { session });

    const studentDoc = student[0];

    await Family.updateOne({ _id: family._id }, { $addToSet: { studentIds: studentDoc._id } }, { session });

    const cycle = await resolveCurrentCycle(session);

    await StudentCycle.updateOne(
      { studentId: studentDoc._id, cycleId: cycle._id, campusId: classroom.campusId },
      {
        $setOnInsert: {
          studentId: studentDoc._id,
          cycleId: cycle._id,
          campusId: classroom.campusId,
          status: 'ABSENT',
        },
      },
      { upsert: true, session }
    );

    await Vacancy.updateOne(
      { studentId: studentDoc._id, cycleId: cycle._id },
      {
        $set: {
          classroomId: classroom._id,
          endDate: null,
          notes: notes || undefined,
        },
        $setOnInsert: {
          studentId: studentDoc._id,
          cycleId: cycle._id,
          startDate: new Date(),
        },
      },
      { upsert: true, session }
    );

    await session.commitTransaction();

    return Student.findById(studentDoc._id)
      .populate('personId')
      .populate('familyId');
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

export async function findStudentByDniService(dni) {
  const person = await Person.findOne({ dni });
  if (!person) return null;
  const student = await Student.findOne({ personId: person._id }).populate('personId').populate('familyId');
  return student;
}