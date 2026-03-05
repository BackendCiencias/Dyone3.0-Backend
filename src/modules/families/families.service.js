import mongoose from 'mongoose';
import { Family } from '../../models/family.model.js';
import { Person } from '../../models/person.model.js';
import { Student } from '../../models/student.model.js';
import { Tutor } from '../../models/tutor.model.js';
import { Counter } from '../../models/counter.model.js';
import { StudentCycle } from '../../models/studentCycle.model.js';
import { Vacancy } from '../../models/vacancy.model.js';
import { Classroom } from '../../models/classroom.model.js';
import { Campus } from '../../models/campus.model.js';
import { Cycle } from '../../models/cycle.model.js';
import { ApiError } from '../../utils/errors.js';
import { findFamiliesList } from './repositories/families.repository.js';
import { runInTransaction } from '../../shared/dbSession.js';
import { registerAuditLog } from '../../shared/audit.service.js';
import { searchFamiliesService as searchFamiliesModuleService } from './services/families.search.service.js';
import { toFamilyListItem } from './presenters/familyListItem.presenter.js';

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

async function resolvePreferredCycleId() {
  const preferredCycle = await Cycle.findOne({ isActive: true })
    .sort({ year: -1, startDate: -1, _id: -1 })
    .select('_id')
    .lean();

  if (preferredCycle?._id) return preferredCycle._id;

  const latestCycle = await Cycle.findOne({})
    .sort({ year: -1, startDate: -1, _id: -1 })
    .select('_id')
    .lean();

  return latestCycle?._id || null;
}

async function enrichStudentsWithCampusStatus(students) {
  if (!students.length) return [];

  const preferredCycleId = await resolvePreferredCycleId();
  const studentIds = students.map((student) => student._id);

  const [studentCycles, vacancies] = await Promise.all([
    preferredCycleId
      ? StudentCycle.find({ studentId: { $in: studentIds }, cycleId: preferredCycleId })
        .select('studentId campusId')
        .lean()
      : Promise.resolve([]),
    preferredCycleId
      ? Vacancy.find({ studentId: { $in: studentIds }, cycleId: preferredCycleId })
        .select('studentId classroomId')
        .lean()
      : Promise.resolve([]),
  ]);

  const campusIdsFromCycles = studentCycles.map((item) => String(item.campusId));
  const classroomIds = vacancies.map((item) => item.classroomId);

  const classrooms = classroomIds.length
    ? await Classroom.find({ _id: { $in: classroomIds } }).select('_id campusId').lean()
    : [];

  const campusIdsFromClassrooms = classrooms.map((item) => String(item.campusId));
  const allCampusIds = [...new Set([...campusIdsFromCycles, ...campusIdsFromClassrooms])]
    .map((id) => new mongoose.Types.ObjectId(id));

  const campuses = allCampusIds.length
    ? await Campus.find({ _id: { $in: allCampusIds } }).select('_id code').lean()
    : [];

  const campusById = new Map(campuses.map((campus) => [String(campus._id), campus.code]));
  const classroomCampusById = new Map(classrooms.map((item) => [String(item._id), String(item.campusId)]));

  const statusByStudentId = new Map();
  const studentCycleCampusByStudentId = new Map();
  studentCycles.forEach((row) => {
    studentCycleCampusByStudentId.set(String(row.studentId), campusById.get(String(row.campusId)) || null);
  });

  const vacancyCampusByStudentId = new Map();
  vacancies.forEach((row) => {
    const campusId = classroomCampusById.get(String(row.classroomId));
    vacancyCampusByStudentId.set(String(row.studentId), campusId ? campusById.get(campusId) || null : null);
  });

  studentIds.forEach((id) => {
    const key = String(id);
    const code = vacancyCampusByStudentId.get(key) ?? studentCycleCampusByStudentId.get(key) ?? null;
    if (code) statusByStudentId.set(key, code);
  });

  return students.map((student) => {
    const campusCode = statusByStudentId.get(String(student._id));
    const currentCampusStatus = campusCode || (student.activeStatus === 'GRADUATED' ? 'EGRESADO' : 'OTRO');

    return {
      ...student,
      currentCampusStatus,
      currentCampusCode: campusCode || null,
    };
  });
}

async function buildFamiliesResponse(families) {
  const allStudents = families.flatMap((family) => family.studentIds || []);
  const enrichedStudents = await enrichStudentsWithCampusStatus(allStudents);
  const studentsById = new Map(enrichedStudents.map((student) => [String(student._id), student]));

  return families.map((family) => {
    const primaryTutor = (family.tutorIds || []).find((tutor) => tutor.isPrimary) || family.tutorIds?.[0] || null;
    const students = (family.studentIds || []).map((student) => studentsById.get(String(student._id)) || student);

    return {
      familyId: String(family._id),
      notes: family.notes || null,
      students,
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
      updatedAt: family.updatedAt || family.createdAt || null,
    };
  });
}

function mapRelationship(value) {
  if (value === 'PADRE' || value === 'Padre') return 'Padre';
  if (value === 'MADRE' || value === 'Madre') return 'Madre';
  if (value === 'HERMANA' || value === 'Hermana') return 'Hermana';
  if (value === 'HERMANO' || value === 'Hermano') return 'Hermano';
  if (value === 'ABUELA' || value === 'Abuela') return 'Abuela';
  if (value === 'ABUELO' || value === 'Abuelo') return 'Abuelo';
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
  const otherTutors = tutors.find((tutor) => tutor.isPrimary == false) || null;

  return {
    familyId: family?._id || null,
    notes: family?.notes || null,
    students: family?.studentIds || null,
    primaryTutor,
    otherTutors,
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
      gender: personData.gender || 'M',
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
      activeStatus: 'ACTIVE',
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

export async function listFamiliesBaseService({ limit = 5, cursor, campus } = {}) {
  const normalizedLimit = Math.max(1, Math.min(10, Number(limit) || 5));

  const families = await findFamiliesList({
    limit: normalizedLimit,
    cursor,
    campus,
  });

  const hasMore = families.length > normalizedLimit;
  const itemsSource = hasMore ? families.slice(0, normalizedLimit) : families;

  const rawItems = await buildFamiliesResponse(itemsSource);
  const items = rawItems.map((item) => toFamilyListItem(item));

  return {
    items,
    nextCursor: hasMore ? String(itemsSource[itemsSource.length - 1]._id) : null,
  };
}

export async function searchFamiliesService({ q, limit = 5, cursor, campus }) {
  const normalizedLimit = Math.max(1, Math.min(50, Number(limit) || 5));
  const campusScope = campus || 'ALL';
  const normalizedRows = await searchFamiliesModuleService({ q, limit: normalizedLimit + 1, campusScope });

  const fromCursor = cursor
    ? normalizedRows.filter((row) => String(row.familyId) > String(cursor))
    : normalizedRows;

  const hasMore = fromCursor.length > normalizedLimit;
  const selectedRows = hasMore ? fromCursor.slice(0, normalizedLimit) : fromCursor;

  return {
    items: selectedRows.map((row) => toFamilyListItem(row)),
    nextCursor: hasMore ? String(selectedRows[selectedRows.length - 1].familyId) : null,
  };
}

export async function linkStudentFamilyService({ studentId, familyId, requestId = 'n/a' }) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!mongoose.Types.ObjectId.isValid(studentId)) throw new ApiError(400, 'studentId inválido');
    if (!mongoose.Types.ObjectId.isValid(familyId)) throw new ApiError(400, 'familyId inválido');

    console.info(
      `[FAMILY][LINK_STUDENT] requestId=${requestId} familyId=${String(familyId)} studentId=${String(studentId)}`
    );

    const student = await Student.findById(studentId).session(session);
    if (!student) throw new ApiError(404, 'Estudiante no encontrado');
    if (student.familyId) throw new ApiError(409, 'Student already belongs to a family');

    const familyDoc = await Family.findById(familyId).session(session);
    if (!familyDoc) throw new ApiError(404, 'Familia no encontrada');

    const previousStudentIds = [...(familyDoc.studentIds || [])];
    const referenceStudentId = previousStudentIds[0] || null;
    const warnings = [];

    let copiedTutorsCount = 0;

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

    if (!referenceStudentId) {
      warnings.push('Family has no tutors to copy');
    } else {
      const referenceTutors = await Tutor.find({ studentId: referenceStudentId }).session(session);
      if (!referenceTutors.length) {
        warnings.push('Family has no tutors to copy');
      } else {
        for (const referenceTutor of referenceTutors) {
          const tutor = await Tutor.findOneAndUpdate(
            { studentId: student._id, tutorPersonId: referenceTutor.tutorPersonId },
            {
              $setOnInsert: {
                studentId: student._id,
                tutorPersonId: referenceTutor.tutorPersonId,
                relationship: referenceTutor.relationship,
                isPrimary: referenceTutor.isPrimary,
                livesWithStudent: referenceTutor.livesWithStudent,
                notes: referenceTutor.notes,
              },
            },
            { upsert: true, new: true, session, rawResult: true }
          );

          const insertedTutor = tutor?.value;
          const wasInserted = !!tutor?.lastErrorObject?.upserted;
          if (insertedTutor?._id) {
            await Family.updateOne(
              { _id: familyDoc._id },
              { $addToSet: { tutorIds: insertedTutor._id } },
              { session }
            );
          }
          if (wasInserted) copiedTutorsCount += 1;
        }
      }
    }

    await session.commitTransaction();

    console.info(`[FAMILY][LINK_STUDENT] copiedTutorsCount=${copiedTutorsCount}`);

    return {
      familyId: familyDoc._id.toString(),
      studentId: student._id.toString(),
      copiedTutorsCount,
      warnings,
      ok: true,
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


export async function updateFamilyTutorService(familyId, tutorId, payload, userId = null) {
  const normalizedPayload = {};
  if (payload.relationship !== undefined) normalizedPayload.relationship = mapRelationship(payload.relationship);
  if (payload.isPrimary !== undefined) normalizedPayload.isPrimary = payload.isPrimary;
  if (payload.livesWithStudent !== undefined) normalizedPayload.livesWithStudent = payload.livesWithStudent;
  if (payload.notes !== undefined) normalizedPayload.notes = payload.notes;

  await runInTransaction(async (session) => {
    const family = await Family.findById(familyId).session(session);
    if (!family) throw new ApiError(404, 'Familia no encontrada');

    if (!family.tutorIds.some((id) => String(id) === String(tutorId))) {
      throw new ApiError(404, 'Tutor no pertenece a la familia');
    }

    const tutor = await Tutor.findById(tutorId).session(session);
    if (!tutor) throw new ApiError(404, 'Tutor no encontrado');

    await Tutor.updateOne({ _id: tutorId }, { $set: normalizedPayload }, { session });

    if (payload.isPrimary === true) {
      await Tutor.updateMany(
        { _id: { $in: family.tutorIds.filter((id) => String(id) !== String(tutorId)) } },
        { $set: { isPrimary: false } },
        { session }
      );
    }
  });

  if (userId) {
    await registerAuditLog({
      entityType: 'FAMILY',
      entityId: familyId,
      action: 'TUTOR_UPDATED',
      performedBy: userId,
      payloadSnapshot: {
        familyId,
        tutorId,
        changes: normalizedPayload,
      },
    });
  }

  return getFamilyByIdService(familyId);
}

export async function deleteFamilyTutorService(familyId, tutorId, userId = null) {
  await runInTransaction(async (session) => {
    const family = await Family.findById(familyId).session(session);
    if (!family) throw new ApiError(404, 'Familia no encontrada');

    if (!family.tutorIds.some((id) => String(id) === String(tutorId))) {
      throw new ApiError(404, 'Tutor no pertenece a la familia');
    }

    const tutor = await Tutor.findById(tutorId).session(session);
    if (!tutor) throw new ApiError(404, 'Tutor no encontrado');

    await Family.updateOne({ _id: familyId }, { $pull: { tutorIds: tutor._id } }, { session });

    const stillReferenced = await Family.exists({ tutorIds: tutor._id }).session(session);
    if (!stillReferenced) {
      await Tutor.deleteOne({ _id: tutor._id }, { session });
    }

    if (tutor.isPrimary) {
      const updatedFamily = await Family.findById(familyId).session(session);
      if (updatedFamily?.tutorIds?.length) {
        const nextPrimaryId = updatedFamily.tutorIds[0];
        await Tutor.updateMany(
          { _id: { $in: updatedFamily.tutorIds } },
          { $set: { isPrimary: false } },
          { session }
        );
        await Tutor.updateOne({ _id: nextPrimaryId }, { $set: { isPrimary: true } }, { session });
      }
    }
  });

  if (userId) {
    await registerAuditLog({
      entityType: 'FAMILY',
      entityId: familyId,
      action: 'TUTOR_DELETED',
      performedBy: userId,
      payloadSnapshot: {
        familyId,
        tutorId,
      },
    });
  }

  return getFamilyByIdService(familyId);
}

export async function unlinkStudentFromFamilyService(familyId, studentId, userId = null) {
  if (!mongoose.Types.ObjectId.isValid(familyId)) throw new ApiError(400, 'familyId inválido');
  if (!mongoose.Types.ObjectId.isValid(studentId)) throw new ApiError(400, 'studentId inválido');

  let deletedTutorsCount = 0;

  await runInTransaction(async (session) => {
    const family = await Family.findById(familyId).session(session);
    if (!family) throw new ApiError(404, 'Familia no encontrada');

    const student = await Student.findById(studentId).session(session);
    if (!student) throw new ApiError(404, 'Estudiante no encontrado');

    const belongsByFamilyArray = family.studentIds.some((id) => String(id) === String(studentId));
    const belongsByStudentFamilyId = student.familyId && String(student.familyId) === String(family._id);

    if (!belongsByFamilyArray || !belongsByStudentFamilyId) {
      throw new ApiError(409, 'Student does not belong to this family');
    }

    await Family.updateOne({ _id: familyId }, { $pull: { studentIds: student._id } }, { session });
    await Student.updateOne({ _id: student._id }, { $set: { familyId: null } }, { session });

    const tutorsToDelete = await Tutor.find({ studentId: student._id }).select('_id').session(session).lean();
    const tutorIdsToDelete = tutorsToDelete.map((tutor) => tutor._id);

    if (tutorIdsToDelete.length) {
      const deleted = await Tutor.deleteMany({ _id: { $in: tutorIdsToDelete } }, { session });
      deletedTutorsCount = deleted?.deletedCount || 0;

      await Family.updateOne(
        { _id: familyId },
        { $pull: { tutorIds: { $in: tutorIdsToDelete } } },
        { session }
      );

      const refreshedFamily = await Family.findById(familyId).session(session);
      if (refreshedFamily?.tutorIds?.length) {
        const primaryExists = await Tutor.findOne({
          _id: { $in: refreshedFamily.tutorIds },
          isPrimary: true,
        }).session(session).lean();

        if (!primaryExists) {
          const nextPrimaryId = refreshedFamily.tutorIds[0];
          await Tutor.updateMany(
            { _id: { $in: refreshedFamily.tutorIds } },
            { $set: { isPrimary: false } },
            { session }
          );
          await Tutor.updateOne({ _id: nextPrimaryId }, { $set: { isPrimary: true } }, { session });
        }
      }
    }
  });

  console.info(`[Families][UNLINK_STUDENT] familyId=${String(familyId)} studentId=${String(studentId)} deletedTutors=${deletedTutorsCount}`);

  if (userId) {
    await registerAuditLog({
      entityType: 'FAMILY',
      entityId: familyId,
      action: 'FAMILY_STUDENT_UNLINKED',
      performedBy: userId,
      payloadSnapshot: {
        familyId,
        studentId,
        newFamilyId: null,
        deletedTutorsCount,
      },
    });
  }

  const family = await getFamilyByIdService(familyId);
  return {
    ok: true,
    familyId,
    studentId,
    newFamilyId: null,
    family,
  };
}


export async function getFamilyByIdService(familyId) {
  if (!mongoose.Types.ObjectId.isValid(familyId)) throw new ApiError(400, 'familyId inválido');

  const family = await hydrateFamily(familyId);
  if (!family) throw new ApiError(404, 'Familia no encontrada');

  return mapFamilyDetail(family);
}
