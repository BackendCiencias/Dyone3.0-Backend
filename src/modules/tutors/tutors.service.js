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
  if (value === 'MADRE') return 'Madre';
  if (value === 'PADRE') return 'Padre';
  return 'Apoderado';
}

async function resolveStudent({ studentId, studentCod }, session) {
  if (studentId) {
    if (!mongoose.Types.ObjectId.isValid(studentId)) throw new ApiError(400, 'studentId inválido');
    const student = await Student.findById(studentId).session(session);
    if (!student) throw new ApiError(404, 'Alumno no encontrado');
    return student;
  }

  if (studentCod) {
    const student = await Student.findOne({ internalCode: studentCod }).session(session);
    if (!student) throw new ApiError(404, 'Alumno no encontrado por studentCod');
    return student;
  }

  throw new ApiError(400, 'Debes enviar studentId o studentCod');
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
      gender: 'Masculino',
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
    const student = await resolveStudent(payload, session);
    const person = await resolveTutorPerson(payload, session);
    const relationship = mapRelationship(payload.relationship);

    const existing = await Tutor.findOne({
      studentId: student._id,
      tutorPersonId: person._id,
      relationship,
    }).session(session);

    await Tutor.updateMany(
      { studentId: student._id, _id: existing ? { $ne: existing._id } : { $exists: true } },
      { $set: { isPrimary: false } },
      { session }
    );

    const updateDoc = {
      studentId: student._id,
      tutorPersonId: person._id,
      relationship,
      isPrimary: true,
      livesWithStudent: true,
      ...(payload.notes ? { notes: payload.notes } : {}),
    };

    const tutor = await Tutor.findOneAndUpdate(
      { studentId: student._id, tutorPersonId: person._id, relationship },
      { $set: updateDoc, $setOnInsert: updateDoc },
      { upsert: true, new: true, session }
    );

    if (student.familyId) {
      await Family.updateOne({ _id: student.familyId }, { $addToSet: { tutorIds: tutor._id } }, { session });
    }

    await session.commitTransaction();

    return Tutor.findById(tutor._id)
      .populate('studentId')
      .populate('tutorPersonId');
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}
