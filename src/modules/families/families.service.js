import mongoose from 'mongoose';
import { Family } from '../../models/family.model.js';
import { Person } from '../../models/person.model.js';
import { Student } from '../../models/student.model.js';
import { Tutor } from '../../models/tutor.model.js';
import { Counter } from '../../models/counter.model.js';
import { ApiError } from '../../utils/errors.js';

// Encuentra o crea una persona por DNI
async function findOrCreatePerson(personData) {
  const existing = await Person.findOne({ dni: personData.dni });
  if (existing) {
    return existing;
  }
  const person = new Person(personData);
  return person.save();
}

function normalizeDni(dni) {
  const normalized = String(dni || '').trim();
  if (!normalized) return undefined;
  const lowered = normalized.toLowerCase();
  if (['null', 'undefined', 'n/a', 'na', '-'].includes(lowered)) return undefined;
  return normalized;
}

function normalizeString(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function mapRelationship(value) {
  if (value === 'PADRE' || value === 'Padre') return 'Padre';
  if (value === 'MADRE' || value === 'Madre') return 'Madre';
  return 'Apoderado';
}

async function nextStudentCode() {
  const counter = await Counter.findOneAndUpdate(
    { key: 'student_internal_code' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  return `COD_A${String(counter.seq).padStart(5, '0')}`;
}

async function hydrateFamily(familyId) {
  return Family.findById(familyId)
    .populate({ path: 'studentIds', populate: { path: 'personId' } })
    .populate({ path: 'tutorIds', populate: { path: 'tutorPersonId' } })
    .lean();
}

function mapFamilyDetail(family) {
  const tutors = (family.tutorIds || []).map((tutor) => ({
    _id: tutor._id,
    relationship: tutor.relationship,
    isPrimary: tutor.isPrimary,
    livesWithStudent: tutor.livesWithStudent,
    studentId: tutor.studentId || null,
    tutorPerson: tutor.tutorPersonId || null,
  }));

  const primaryTutor = tutors.find((tutor) => tutor.isPrimary) || null;

  return {
    family: {
      _id: family._id,
      notes: family.notes || null,
      studentsCount: family.studentIds?.length || 0,
      tutorsCount: family.tutorIds?.length || 0,
    },
    students: (family.studentIds || []).map((student) => ({
      _id: student._id,
      internalCode: student.internalCode || null,
      person: student.personId || null,
      summary: student.personId ? {
        names: student.personId.names,
        lastNames: student.personId.lastNames,
        dni: student.personId.dni || null,
      } : null,
    })),
    tutors,
    primaryTutor,
  };
}

async function resolveOrCreateTutorPerson(payload, session) {
  if (payload.personId) {
    const person = await Person.findById(payload.personId).session(session);
    if (!person) throw new ApiError(404, 'Persona de tutor no encontrada');
    return person;
  }

  const personData = payload.person;
  if (!personData) throw new ApiError(400, 'person es requerido');

  const normalizedDni = normalizeDni(personData.dni);
  let person = null;
  if (normalizedDni) {
    person = await Person.findOne({ dni: normalizedDni }).session(session);
  }

  if (!person) {
    person = new Person({
      names: personData.names,
      lastNames: personData.lastNames,
      gender: personData.gender || 'Masculino',
      ...(normalizedDni ? { dni: normalizedDni } : {}),
      ...(personData.phone ? { phone: personData.phone } : {}),
      ...(personData.email ? { email: personData.email } : {}),
    });
    await person.save({ session });
    return person;
  }

  const setUpdates = {};
  if (personData.names && personData.names !== person.names) setUpdates.names = personData.names;
  if (personData.lastNames && personData.lastNames !== person.lastNames) setUpdates.lastNames = personData.lastNames;
  if (personData.phone && personData.phone !== person.phone) setUpdates.phone = personData.phone;
  if (personData.email && personData.email !== person.email) setUpdates.email = personData.email;
  if (personData.gender && personData.gender !== person.gender) setUpdates.gender = personData.gender;

  if (Object.keys(setUpdates).length) {
    await Person.updateOne({ _id: person._id }, { $set: setUpdates }, { session });
  }

  return person;
}

async function resolveFamilyStudent(familyDoc, studentId, session) {
  if (studentId) {
    const student = await Student.findById(studentId).session(session);
    if (!student) throw new ApiError(404, 'Estudiante no encontrado');
    if (String(student.familyId) !== String(familyDoc._id)) {
      throw new ApiError(409, 'El estudiante no pertenece a la familia');
    }
    return student;
  }

  if (!familyDoc.studentIds?.length) {
    throw new ApiError(409, 'La familia no tiene estudiantes vinculados para asociar tutor');
  }

  const student = await Student.findById(familyDoc.studentIds[0]).session(session);
  if (!student) throw new ApiError(404, 'Estudiante base de familia no encontrado');
  return student;
}

export async function createFamilyService({ tutors, students, notes }) {
  const family = new Family({ notes, tutorIds: [], studentIds: [] });
  await family.save();

  for (const stu of students) {
    const person = await findOrCreatePerson(stu);
    const existingStudent = await Student.findOne({ personId: person._id });
    const studentDoc = existingStudent || new Student({
      personId: person._id,
      familyId: family._id,
      internalCode: await nextStudentCode(),
      isActive: true,
    });
    if (!studentDoc.internalCode) {
      studentDoc.internalCode = await nextStudentCode();
    }
    await studentDoc.save();
    family.studentIds.push(studentDoc._id);
  }

  for (const tut of tutors) {
    await findOrCreatePerson(tut);
  }

  await family.save();
  return Family.findById(family._id).populate({ path: 'studentIds', populate: { path: 'personId' } });
}

export async function searchFamiliesService({ q, limit = 20, cursor }) {
  const normalizedTerm = normalizeString(q);
  if (!normalizedTerm) throw new ApiError(400, 'q es requerido');

  const families = await Family.find({})
    .sort({ _id: 1 })
    .populate({ path: 'studentIds', populate: { path: 'personId' } })
    .populate({ path: 'tutorIds', populate: { path: 'tutorPersonId' } })
    .lean();

  const filtered = families.filter((family) => {
    const fields = [
      family._id,
      family.notes,
      ...(family.studentIds || []).flatMap((student) => [
        student.internalCode,
        student.personId?.names,
        student.personId?.lastNames,
        student.personId?.dni,
        student.personId?.phone,
      ]),
      ...(family.tutorIds || []).flatMap((tutor) => [
        tutor.relationship,
        tutor.tutorPersonId?.names,
        tutor.tutorPersonId?.lastNames,
        tutor.tutorPersonId?.dni,
        tutor.tutorPersonId?.phone,
      ]),
    ];

    return fields.some((value) => normalizeString(value).includes(normalizedTerm));
  });

  const fromCursor = cursor
    ? filtered.filter((family) => String(family._id) > String(cursor))
    : filtered;

  const normalizedLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  const selected = fromCursor.slice(0, normalizedLimit + 1);
  const hasMore = selected.length > normalizedLimit;
  const itemsSource = hasMore ? selected.slice(0, normalizedLimit) : selected;

  const items = itemsSource.map((family) => {
    const primaryTutor = (family.tutorIds || []).find((tutor) => tutor.isPrimary) || family.tutorIds?.[0] || null;
    return {
      familyId: String(family._id),
      notes: family.notes || null,
      studentsCount: family.studentIds?.length || 0,
      tutorsCount: family.tutorIds?.length || 0,
      primaryTutor: primaryTutor ? {
        tutorId: String(primaryTutor._id),
        names: primaryTutor.tutorPersonId?.names || null,
        lastNames: primaryTutor.tutorPersonId?.lastNames || null,
        dni: primaryTutor.tutorPersonId?.dni || null,
        phone: primaryTutor.tutorPersonId?.phone || null,
        relationship: primaryTutor.relationship || null,
      } : null,
    };
  });

  return {
    items,
    nextCursor: hasMore ? String(itemsSource[itemsSource.length - 1]._id) : null,
  };
}

export async function linkStudentFamilyService({ studentId, familyId, family }) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!mongoose.Types.ObjectId.isValid(studentId)) throw new ApiError(400, 'studentId inválido');

    const student = await Student.findById(studentId).session(session);
    if (!student) throw new ApiError(404, 'Estudiante no encontrado');

    let familyDoc;
    let created = false;

    if (familyId) {
      if (!mongoose.Types.ObjectId.isValid(familyId)) throw new ApiError(400, 'familyId inválido');
      familyDoc = await Family.findById(familyId).session(session);
      if (!familyDoc) throw new ApiError(404, 'Familia no encontrada');
    } else {
      const notes = [family?.address ? `Dirección: ${family.address}` : null, family?.campusId ? `Campus: ${family.campusId}` : null]
        .filter(Boolean)
        .join(' | ');
      familyDoc = new Family({
        tutorIds: [],
        studentIds: [],
        ...(notes ? { notes } : {}),
      });
      await familyDoc.save({ session });
      created = true;
    }

    await Student.updateOne(
      { _id: student._id },
      { $set: { familyId: familyDoc._id } },
      { session }
    );

    await Family.updateOne(
      { _id: familyDoc._id },
      { $addToSet: { studentIds: student._id } },
      { session }
    );

    if (family?.guardians?.length) {
      let isPrimaryAssigned = false;
      for (const guardian of family.guardians) {
        let person = null;
        if (guardian.dni) {
          person = await Person.findOne({ dni: guardian.dni.trim() }).session(session);
        }

        if (!person) {
          person = await Person.create([
            {
              names: guardian.names,
              lastNames: guardian.lastNames,
              dni: guardian.dni?.trim() || undefined,
              gender: 'Masculino',
              phone: guardian.phone,
              email: guardian.email,
            },
          ], { session }).then((docs) => docs[0]);
        }

        const relationship = mapRelationship(guardian.relationship);
        const tutor = await Tutor.findOneAndUpdate(
          { studentId: student._id, tutorPersonId: person._id, relationship },
          {
            $set: {
              studentId: student._id,
              tutorPersonId: person._id,
              relationship,
              isPrimary: !isPrimaryAssigned,
              livesWithStudent: true,
            },
          },
          { upsert: true, new: true, session }
        );

        isPrimaryAssigned = true;

        await Family.updateOne(
          { _id: familyDoc._id },
          { $addToSet: { tutorIds: tutor._id } },
          { session }
        );
      }
    }

    await session.commitTransaction();

    const hydratedFamily = await Family.findById(familyDoc._id)
      .populate({ path: 'tutorIds', populate: { path: 'tutorPersonId' } })
      .populate('studentIds')
      .lean();

    const mainTutor = hydratedFamily?.tutorIds?.find((t) => t.isPrimary);
    const guardianName = mainTutor?.tutorPersonId
      ? `${mainTutor.tutorPersonId.names} ${mainTutor.tutorPersonId.lastNames}`.trim()
      : null;

    return {
      created,
      familyId: familyDoc._id.toString(),
      family: {
        id: familyDoc._id.toString(),
        familyName: guardianName,
        mainGuardian: guardianName,
        guardiansCount: hydratedFamily?.tutorIds?.length || 0,
        studentIds: hydratedFamily?.studentIds?.map((s) => s._id.toString()) || [],
      },
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

export async function addTutorToFamilyService(familyId, payload) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const familyDoc = await Family.findById(familyId).session(session);
    if (!familyDoc) throw new ApiError(404, 'Familia no encontrada');

    const student = await resolveFamilyStudent(familyDoc, payload.studentId, session);
    const relationship = mapRelationship(payload.relationship);

    let tutor = null;
    if (payload.mode === 'linkExisting' && payload.tutorId) {
      tutor = await Tutor.findById(payload.tutorId).session(session);
      if (!tutor) throw new ApiError(404, 'Tutor no encontrado');
      if (!familyDoc.studentIds.some((id) => String(id) === String(tutor.studentId))) {
        throw new ApiError(409, 'Tutor no pertenece a estudiantes de esta familia');
      }

      await Tutor.updateOne(
        { _id: tutor._id },
        {
          $set: {
            relationship,
            livesWithStudent: payload.livesWithStudent ?? tutor.livesWithStudent,
            studentId: student._id,
          },
        },
        { session }
      );
    } else {
      const person = await resolveOrCreateTutorPerson(payload, session);
      tutor = await Tutor.findOneAndUpdate(
        { studentId: student._id, tutorPersonId: person._id, relationship },
        {
          $set: {
            studentId: student._id,
            tutorPersonId: person._id,
            relationship,
            livesWithStudent: payload.livesWithStudent ?? true,
          },
          $setOnInsert: {
            isPrimary: false,
          },
        },
        { upsert: true, new: true, session }
      );
    }

    await Family.updateOne(
      { _id: familyDoc._id },
      { $addToSet: { tutorIds: tutor._id } },
      { session }
    );

    if (payload.isPrimary === true) {
      await Tutor.updateMany(
        {
          _id: {
            $in: familyDoc.tutorIds.filter((id) => String(id) !== String(tutor._id)),
          },
        },
        { $set: { isPrimary: false } },
        { session }
      );
      await Tutor.updateOne({ _id: tutor._id }, { $set: { isPrimary: true } }, { session });
    }

    await session.commitTransaction();

    const family = await hydrateFamily(familyDoc._id);
    return {
      familyId: String(familyDoc._id),
      tutorId: String(tutor._id),
      family: mapFamilyDetail(family),
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

export async function setFamilyPrimaryTutorService(familyId, tutorId) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const family = await Family.findById(familyId).session(session);
    if (!family) throw new ApiError(404, 'Familia no encontrada');

    if (!family.tutorIds.some((id) => String(id) === String(tutorId))) {
      throw new ApiError(409, 'El tutor no pertenece a la familia');
    }

    const tutor = await Tutor.findById(tutorId).session(session);
    if (!tutor) throw new ApiError(404, 'Tutor no encontrado');

    if (tutor.isPrimary) throw new ApiError(409, 'El tutor ya es principal');

    await Tutor.updateMany(
      { _id: { $in: family.tutorIds } },
      { $set: { isPrimary: false } },
      { session }
    );

    await Tutor.updateOne({ _id: tutorId }, { $set: { isPrimary: true } }, { session });

    await session.commitTransaction();

    const hydrated = await hydrateFamily(family._id);
    return {
      familyId: String(family._id),
      primaryTutorId: String(tutorId),
      family: mapFamilyDetail(hydrated),
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

export async function getFamilyByIdService(familyId) {
  if (!mongoose.Types.ObjectId.isValid(familyId)) throw new ApiError(400, 'familyId inválido');

  const family = await hydrateFamily(familyId);
  if (!family) throw new ApiError(404, 'Familia no encontrada');

  return mapFamilyDetail(family);
}
