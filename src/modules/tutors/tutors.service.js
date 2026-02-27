import mongoose from 'mongoose';
import { Student } from '../../models/student.model.js';
import { Person } from '../../models/person.model.js';
import { Tutor } from '../../models/tutor.model.js';
import { Family } from '../../models/family.model.js';
import { ApiError } from '../../utils/errors.js';

function normalizeDni(dni) {
  const normalized = String(dni || '').trim();
  if (!normalized) return undefined;
  if (['null', 'undefined', 'n/a', 'na', '-'].includes(normalized.toLowerCase())) return undefined;
  return normalized;
}

function normalizePhones(phones) {
  const raw = Array.isArray(phones) ? phones.join(' ') : String(phones || '');
  if (!raw.trim()) return [];

  return raw
    .split(/[;,\-\s]+/)
    .map((v) => v.replace(/\D/g, ''))
    .filter(Boolean);
}

function mapRelationship(value) {
  const allowedRelationships = ['MADRE', 'PADRE', 'HERMANA', 'HERMANO', 'ABUELA', 'ABUELO', 'APODERADO'];
  if (!value || !allowedRelationships.includes(String(value).toUpperCase())) {
    throw new ApiError(400, `Relación no permitida. Valores permitidos: ${allowedRelationships.join(', ')}`);
  }

  if (value === 'PADRE' || value === 'Padre') return 'Padre';
  if (value === 'MADRE' || value === 'Madre') return 'Madre';
  if (value === 'HERMANA' || value === 'Hermana') return 'Hermana';
  if (value === 'HERMANO' || value === 'Hermano') return 'Hermano';
  if (value === 'ABUELA' || value === 'Abuela') return 'Abuela';
  if (value === 'ABUELO' || value === 'Abuelo') return 'Abuelo';
  return 'Apoderado';
}

function extractStudentCods(payload) {
  const candidateCods = [];

  if (payload.studentCod) candidateCods.push(payload.studentCod);
  if (Array.isArray(payload.studentCods)) candidateCods.push(...payload.studentCods);
  if (Array.isArray(payload.studentsCod)) candidateCods.push(...payload.studentsCod);

  const normalizedCods = [...new Set(candidateCods
    .map((cod) => String(cod || '').trim())
    .filter(Boolean))];

  if (!normalizedCods.length && !payload.studentId) {
    throw new ApiError(400, 'Debes enviar al menos un código de alumno en studentCods (compatible con studentCod/studentsCod) o studentId');
  }

  return normalizedCods;
}

async function resolveStudents({ studentId, studentCods }, session) {
  if (studentId) {
    if (!mongoose.Types.ObjectId.isValid(studentId)) throw new ApiError(400, 'studentId inválido');
    const student = await Student.findById(studentId).session(session);
    if (!student) throw new ApiError(404, 'Alumno no encontrado');
    return [student];
  }

  const students = [];
  for (const studentCod of studentCods) {
    const student = await Student.findOne({
      $or: [{ internalCode: studentCod }, { bankCode: studentCod }],
    }).session(session);

    if (!student) throw new ApiError(404, `Alumno no encontrado por código: ${studentCod}`);
    students.push(student);
  }

  return students;
}

async function resolveTutorPerson({ names, lastNames, dni, phones }, session) {
  const normalizedDni = normalizeDni(dni);
  const normalizedPhones = normalizePhones(phones);
  const mainPhone = normalizedPhones[0];
  const extraPhones = normalizedPhones.slice(1);

  let person = null;
  if (normalizedDni) {
    person = await Person.findOne({ dni: normalizedDni }).session(session);
  }

  if (!person) {
    person = new Person({
      names,
      lastNames,
      ...(normalizedDni ? { dni: normalizedDni } : {}),
      gender: 'M',
      ...(mainPhone ? { phone: mainPhone } : {}),
      ...(extraPhones.length ? { notes: `Teléfonos adicionales: ${extraPhones.join(', ')}` } : {}),
    });
    await person.save({ session });
    return person;
  }

  const setUpdates = {};
  if (person.names !== names) setUpdates.names = names;
  if (person.lastNames !== lastNames) setUpdates.lastNames = lastNames;
  if (normalizedDni && person.dni !== normalizedDni) setUpdates.dni = normalizedDni;
  if (mainPhone && person.phone !== mainPhone) setUpdates.phone = mainPhone;
  if (extraPhones.length) {
    const extraNote = `Teléfonos adicionales: ${extraPhones.join(', ')}`;
    if (!(person.notes || '').includes(extraNote)) {
      setUpdates.notes = person.notes ? `${person.notes} | ${extraNote}` : extraNote;
    }
  }

  if (Object.keys(setUpdates).length) {
    await Person.updateOne({ _id: person._id }, { $set: setUpdates }, { session });
  }

  return person;
}

export async function upsertTutorService(payload) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const studentCods = extractStudentCods(payload);
    const students = await resolveStudents({ studentId: payload.studentId, studentCods }, session);
    const requestFamilyId = payload.familyId;

    if (requestFamilyId) {
      if (!mongoose.Types.ObjectId.isValid(requestFamilyId)) throw new ApiError(400, 'familyId inválido');
      const requestFamily = await Family.findById(requestFamilyId).session(session);
      if (!requestFamily) throw new ApiError(404, 'La familia indicada en familyId no existe');
    }

    const person = await resolveTutorPerson(payload, session);
    const relationship = mapRelationship(payload.relationship);

    const tutorIds = [];
    const affectedFamilyIds = new Set();

    for (const student of students) {
      const existing = await Tutor.findOne({
        studentId: student._id,
        tutorPersonId: person._id,
        relationship,
      }).session(session);

      if (payload.isPrimary === true) {
        await Tutor.updateMany(
          { studentId: student._id, _id: existing ? { $ne: existing._id } : { $exists: true } },
          { $set: { isPrimary: false } },
          { session }
        );
      }

      const setDoc = {
        ...(payload.isPrimary !== undefined ? { isPrimary: payload.isPrimary } : { isPrimary: true }),
        ...(payload.livesWithStudent !== undefined ? { livesWithStudent: payload.livesWithStudent } : { livesWithStudent: true }),
        ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
      };

      const setOnInsertDoc = {
        studentId: student._id,
        tutorPersonId: person._id,
        relationship,
      };

      const tutor = await Tutor.findOneAndUpdate(
        { studentId: student._id, tutorPersonId: person._id, relationship },
        { $set: setDoc, $setOnInsert: setOnInsertDoc },
        { upsert: true, new: true, session }
      );

      tutorIds.push(tutor._id);

      if (student.familyId) {
        await Family.updateOne({ _id: student.familyId }, { $addToSet: { tutorIds: tutor._id } }, { session });
        affectedFamilyIds.add(String(student.familyId));
      }

      if (requestFamilyId) {
        await Family.updateOne({ _id: requestFamilyId }, { $addToSet: { tutorIds: tutor._id } }, { session });
        affectedFamilyIds.add(String(requestFamilyId));
      }
    }

    await session.commitTransaction();

    const tutors = await Tutor.find({ _id: { $in: tutorIds } })
      .populate('studentId')
      .populate('tutorPersonId');

    const tutorsById = new Map(tutors.map((tutor) => [String(tutor._id), tutor]));
    const orderedTutors = tutorIds.map((id) => tutorsById.get(String(id))).filter(Boolean);

    // Contrato final: se retorna un resumen multiestudiante y compatibilidad con primaryTutor (primer alumno resuelto).
    return {
      primaryTutor: orderedTutors[0] || null,
      tutors: orderedTutors,
      tutorsCount: orderedTutors.length,
      familyIds: [...affectedFamilyIds],
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}
