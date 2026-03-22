import mongoose from 'mongoose';
import { Student } from '../../models/student.model.js';
import { Person } from '../../models/person.model.js';
import { Tutor } from '../../models/tutor.model.js';
import { Family } from '../../models/family.model.js';
import { ApiError } from '../../utils/errors.js';
import { buildAccentInsensitiveRegex, buildSearchScore, byScoreThenId, normalizeSearchTerm } from '../../utils/search.js';
import { normalizePersonLastNames, normalizePersonNames, normalizePersonUpdatePayload } from '../../utils/personNameFormatter.js';

function normalizeDni(dni) {
  const normalized = String(dni || '').trim();
  if (!normalized) return undefined;
  if (['null', 'undefined', 'n/a', 'na', '-'].includes(normalized.toLowerCase())) return undefined;
  return normalized;
}

function normalizePhone(value) {
  const raw = String(value || '').trim().replace(/\s+/g, ' ');
  if (!raw) return undefined;

  const normalized = raw.replace(/[\s-]+/g, '');
  return normalized || undefined;
}

function normalizePhones(phones) {
  if (Array.isArray(phones)) {
    return phones.map(normalizePhone).filter(Boolean);
  }

  const normalized = normalizePhone(phones);
  return normalized ? [normalized] : [];
}

function mapRelationship(value) {
  if (!value) throw new ApiError(400, 'relationship requerido');

  const normalized =
    String(value)
      .trim()
      .toLowerCase()
      .replace(/^\w/, (c) => c.toUpperCase()); // Padre, Madre, Tia...

  return normalized;
}

function dedupeTutorLinks(rows = []) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${String(row.studentId)}::${String(row.relationship || '')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

async function resolveTutorPerson({ names, lastNames, dni, phones, phone }, session) {
  const normalizedDni = normalizeDni(dni);
  const normalizedPhones = normalizePhones(phones);
  const fallbackPhone = normalizePhone(phone);
  const resolvedPhones = normalizedPhones.length ? normalizedPhones : (fallbackPhone ? [fallbackPhone] : []);
  const mainPhone = resolvedPhones[0];
  const extraPhones = resolvedPhones.slice(1);

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
    await Person.updateOne({ _id: person._id }, normalizePersonUpdatePayload({ $set: setUpdates }), { session });
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

    const personPayload = {
      ...payload,
      names: normalizePersonNames(payload.names),
      lastNames: normalizePersonLastNames(payload.lastNames),
    };
    const person = await resolveTutorPerson(personPayload, session);
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
      .populate({ path: 'tutorPersonId', select: 'names lastNames dni phone gender' });

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

export async function searchTutorsService({ q, limit = 8 }) {
  const term = String(q || '').trim();
  if (!term) throw new ApiError(400, 'q es requerido');

  const normalizedLimit = Math.max(1, Math.min(20, Number(limit || 8)));
  const regex = buildAccentInsensitiveRegex(term);
  const normalizedQ = normalizeSearchTerm(term);

  const people = await Person.find({
    $or: [
      { dni: regex },
      { names: regex },
      { lastNames: regex },
      { phone: regex },
    ],
  })
    .select('_id names lastNames dni phone gender')
    .limit(normalizedLimit * 4)
    .lean();

  if (!people.length) {
    return { items: [], nextCursor: null };
  }

  const personIds = people.map((person) => person._id);
  const studentPeople = await Student.find({ personId: { $in: personIds } })
    .select('personId')
    .lean();
  const studentPersonIdSet = new Set(studentPeople.map((row) => String(row.personId)));

  const tutorPeople = people.filter((person) => !studentPersonIdSet.has(String(person._id)));
  if (!tutorPeople.length) {
    return { items: [], nextCursor: null };
  }

  const tutorPersonIds = tutorPeople.map((person) => person._id);
  const tutorLinks = await Tutor.find({ tutorPersonId: { $in: tutorPersonIds } })
    .select('tutorPersonId studentId relationship isPrimary')
    .populate({ path: 'studentId', populate: { path: 'personId', select: 'names lastNames' } })
    .lean();

  const linksByPersonId = new Map();
  for (const link of tutorLinks) {
    const key = String(link.tutorPersonId);
    if (!linksByPersonId.has(key)) linksByPersonId.set(key, []);
    linksByPersonId.get(key).push(link);
  }

  const items = tutorPeople
    .map((person) => {
      const relatedRows = dedupeTutorLinks(linksByPersonId.get(String(person._id)) || []);
      return {
        id: String(person._id),
        personId: String(person._id),
        names: person.names || '',
        lastNames: person.lastNames || '',
        fullName: [person.lastNames, person.names].filter(Boolean).join(', '),
        dni: person.dni || '',
        phone: person.phone || '',
        gender: person.gender || 'M',
        relationshipHints: [...new Set(relatedRows.map((row) => row.relationship).filter(Boolean))],
        linkedStudents: relatedRows.map((row) => ({
          studentId: String(row.studentId?._id || row.studentId || ''),
          fullName: [
            row.studentId?.personId?.lastNames || '',
            row.studentId?.personId?.names || '',
          ].filter(Boolean).join(', '),
          relationship: row.relationship || 'Apoderado',
          isPrimary: Boolean(row.isPrimary),
        })).filter((row) => row.studentId),
        score: buildSearchScore({
          normalizedQ,
          dni: person.dni,
          names: person.names,
          lastNames: person.lastNames,
          internalCode: person.phone,
        }),
      };
    })
    .sort(byScoreThenId)
    .slice(0, normalizedLimit)
    .map(({ score, ...item }) => item);

  return {
    items,
    nextCursor: null,
  };
}


export async function updateTutorService(tutorId, payload) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const tutor = await Tutor.findById(tutorId).session(session);
    if (!tutor) throw new ApiError(404, 'Tutor no encontrado');

    const personUpdates = {};
    if (payload.names !== undefined) personUpdates.names = normalizePersonNames(payload.names);
    if (payload.lastNames !== undefined) personUpdates.lastNames = normalizePersonLastNames(payload.lastNames);
    if (payload.dni !== undefined) personUpdates.dni = normalizeDni(payload.dni);
    if (payload.phone !== undefined) personUpdates.phone = normalizePhone(payload.phone);
    if (payload.gender !== undefined) personUpdates.gender = payload.gender;

    if (Object.keys(personUpdates).length) {
      await Person.updateOne({ _id: tutor.tutorPersonId }, normalizePersonUpdatePayload({ $set: personUpdates }), { session });
    }

    const tutorUpdates = {};
    if (payload.relationship !== undefined) tutorUpdates.relationship = mapRelationship(payload.relationship);
    if (payload.isPrimary !== undefined) tutorUpdates.isPrimary = payload.isPrimary;
    if (payload.livesWithStudent !== undefined) tutorUpdates.livesWithStudent = payload.livesWithStudent;
    if (payload.notes !== undefined) tutorUpdates.notes = payload.notes;

    if (payload.isPrimary === true) {
      await Tutor.updateMany(
        { studentId: tutor.studentId, _id: { $ne: tutor._id } },
        { $set: { isPrimary: false } },
        { session }
      );
    }

    if (Object.keys(tutorUpdates).length) {
      await Tutor.updateOne({ _id: tutor._id }, { $set: tutorUpdates }, { session });
    }

    await session.commitTransaction();

    return Tutor.findById(tutor._id)
      .populate({ path: 'tutorPersonId', select: 'names lastNames dni phone gender' })
      .populate('studentId');
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

export async function deleteTutorService(tutorId) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const tutor = await Tutor.findById(tutorId).session(session);
    if (!tutor) throw new ApiError(404, 'Tutor no encontrado');

    const student = await Student.findById(tutor.studentId).session(session);
    if (student?.familyId) {
      await Family.updateOne(
        { _id: student.familyId },
        { $pull: { tutorIds: tutor._id } },
        { session }
      );
    }

    await Tutor.deleteOne({ _id: tutor._id }, { session });

    const hasMoreTutors = await Tutor.exists({ tutorPersonId: tutor.tutorPersonId }).session(session);
    if (!hasMoreTutors) {
      await Person.deleteOne({ _id: tutor.tutorPersonId }, { session });
    }

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}
