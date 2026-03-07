import mongoose from 'mongoose';
import { Person } from '../../models/person.model.js';
import { Student } from '../../models/student.model.js';
import { Tutor } from '../../models/tutor.model.js';
import { Family } from '../../models/family.model.js';
import { Enrollment } from '../../models/enrollment.model.js';
import { EnrollmentStudent, NO_APLICA_PENSION } from '../../models/enrollmentStudent.model.js';
import { Vacancy } from '../../models/vacancy.model.js';
import { getCapacityForClassroom } from './services/enrollmentsCapacity.service.js';
import { ContractSnapshot } from '../../models/contractSnapshot.model.js';
import { Charge } from '../../models/charge.model.js';
import {
  buildAdmissionFeeCharge,
  buildContractSnapshot,
  buildEnrollmentFeeCharge,
  buildTuitionCharges,
  derivePreviousSchoolType,
  isOwnCampus,
  resolveBillingConceptsByCode,
  upsertStudentCycleForEnrollment,
} from './services/enrollmentConfirmation.helpers.js';
import { Cycle } from '../../models/cycle.model.js';
import { Campus } from '../../models/campus.model.js';
import { Classroom } from '../../models/classroom.model.js';
import { StudentCycle } from '../../models/studentCycle.model.js';
import { Counter } from '../../models/counter.model.js';
import { ApiError } from '../../utils/errors.js';
import { runInTransaction } from '../../shared/dbSession.js';
import { registerAuditLog } from '../../shared/audit.service.js';
import { buildSearchScore } from '../../utils/search.js';
import { intakeSearch } from './services/intake.search.service.js';

const SCHOOL_MONTHS = 10;

function normalizePensionMonthlyAmounts(row = {}) {
  if (Array.isArray(row.pensionMonthlyAmounts)) {
    if (row.pensionMonthlyAmounts.length !== SCHOOL_MONTHS) {
      throw new ApiError(400, `pensionMonthlyAmounts debe tener ${SCHOOL_MONTHS} elementos`);
    }

    if (row.pensionMonthlyAmounts.some((value) => value === null || value === undefined || Number(value) < NO_APLICA_PENSION)) {
      throw new ApiError(400, `Todos los valores de pensionMonthlyAmounts deben ser >= ${NO_APLICA_PENSION}`);
    }

    return row.pensionMonthlyAmounts.map(Number);
  }

  if (row.monthlyAmount !== undefined) {
    if (Number(row.monthlyAmount) < 0) throw new ApiError(400, 'monthlyAmount no puede ser negativo');
    return Array(SCHOOL_MONTHS).fill(Number(row.monthlyAmount));
  }

  return Array(SCHOOL_MONTHS).fill(NO_APLICA_PENSION);
}

function firstApplicablePensionAmount(values = []) {
  return values.find((amount) => amount >= 0) ?? null;
}

async function nextStudentCodeSession(session) {
  const counter = await Counter.findOneAndUpdate(
    { key: 'student_internal_code' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session }
  );

  return `COD_A${String(counter.seq).padStart(5, '0')}`;
}

async function findOrCreatePersonSession(personData, session) {
  const existing = await Person.findOne({ dni: personData.dni }).session(session);
  if (existing) return existing;
  const person = new Person(personData);
  await person.save({ session });
  return person;
}

async function createEnrollmentStudentSession({
  enrollmentId,
  studentId,
  classroomId,
  userId,
  monthlyAmount,
  pensionMonthlyAmounts,
  admissionFee,
  enrollmentFee,
  previousSchoolType,
}, session) {
  const enrollmentStudent = new EnrollmentStudent({
    enrollmentId,
    studentId,
    classroomId: classroomId || null,
    agreedBy: userId,
    agreedAt: new Date(),
    pensionMonthlyAmounts: normalizePensionMonthlyAmounts({ pensionMonthlyAmounts, monthlyAmount }),
    admissionFee: {
      applies: admissionFee?.applies === true,
      amount: Number(admissionFee?.amount || 0),
      isExempt: admissionFee?.isExempt === true,
      reason: admissionFee?.reason,
    },
    enrollmentFee: {
      amount: Number(enrollmentFee?.amount || 0),
      isExempt: enrollmentFee?.isExempt === true,
      reason: enrollmentFee?.reason,
    },
    previousSchoolType: previousSchoolType || 'OTHER',
    previousSchoolName: previousSchoolType === 'OTHER' ? 'EXTERNO' : undefined,
  });

  await enrollmentStudent.save({ session });
  return enrollmentStudent;
}

async function hydrateLegacyEnrollmentStudents(enrollmentId, session) {
  const enrollment = await Enrollment.findById(enrollmentId).session(session);
  if (!enrollment) throw new ApiError(404, 'Matrícula no encontrada');

  if (Array.isArray(enrollment.enrollmentStudents) && enrollment.enrollmentStudents.length) {
    return enrollment;
  }

  const legacyStudentIds = (enrollment.studentIds || []).map((id) => String(id));
  if (!legacyStudentIds.length) return enrollment;

  const existingRows = await EnrollmentStudent.find({ enrollmentId: enrollment._id, studentId: { $in: legacyStudentIds } })
    .select('_id studentId')
    .session(session);
  const existingByStudent = new Map(existingRows.map((row) => [String(row.studentId), row._id]));

  let snapshot = await ContractSnapshot.findOne({ $or: [{ enrollmentId: enrollment._id }, { matriculaId: enrollment._id }] }).session(session);
  const enrollmentStudents = [];

  for (const studentId of legacyStudentIds) {
    let id = existingByStudent.get(studentId);
    if (!id) {
      const snapshotStudent = snapshot?.students?.find((entry) => String(entry.studentId) === studentId);
      const created = new EnrollmentStudent({
        enrollmentId: enrollment._id,
        studentId,
        pensionMonthlyAmounts: normalizePensionMonthlyAmounts(snapshotStudent || {}),
      });
      await created.save({ session });
      id = created._id;
    }
    enrollmentStudents.push(id);
  }

  await Enrollment.updateOne(
    { _id: enrollment._id },
    { $set: { enrollmentStudents, updatedBy: enrollment.updatedBy || enrollment.createdBy || enrollment.createdByUserId || null } },
    { session }
  );

  return Enrollment.findById(enrollment._id).session(session);
}

async function createQuickEnrollmentService(data, createdByUserId) {
  const result = await runInTransaction(async (session) => {
    const student = await Student.findById(data.studentId).session(session);
    if (!student) throw new ApiError(404, 'Estudiante no encontrado');
    if (!student.familyId) throw new ApiError(400, 'El estudiante no tiene familia vinculada');

    const cycle = await Cycle.findById(data.cycleId).session(session);
    if (!cycle) throw new ApiError(404, 'Ciclo no encontrado');

    const classroom = await Classroom.findById(data.classroomId).session(session);
    if (!classroom) throw new ApiError(404, 'Classroom no encontrado');

    const previousSchoolType = derivePreviousSchoolType(student.previousCampus);
    const admissionFee = isOwnCampus(student.previousCampus)
      ? { applies: false, amount: 0, isExempt: true, reason: 'Traslado interno' }
      : (data.admissionFee || {});

    let enrollment = await Enrollment.findOne({
      familyId: student.familyId,
      cycleId: cycle._id,
      campusId: classroom.campusId,
      status: 'DRAFT',
    }).session(session);

    if (!enrollment) {
      enrollment = new Enrollment({
        familyId: student.familyId,
        cycleId: cycle._id,
        campusId: classroom.campusId,
        studentIds: [student._id],
        status: 'DRAFT',
        createdBy: createdByUserId,
        createdByUserId: createdByUserId,
        notes: data.notes || undefined,
      });
      await enrollment.save({ session });
    } else {
      const studentIds = new Set((enrollment.studentIds || []).map((id) => String(id)));
      studentIds.add(String(student._id));
      enrollment.studentIds = [...studentIds].map((id) => new mongoose.Types.ObjectId(id));
      enrollment.notes = data.notes || enrollment.notes;
      enrollment.updatedBy = createdByUserId;
      await enrollment.save({ session });
    }

    const existingEnrollmentStudent = await EnrollmentStudent.findOne({ enrollmentId: enrollment._id, studentId: student._id }).session(session);
    if (existingEnrollmentStudent) {
      existingEnrollmentStudent.classroomId = classroom._id;
      existingEnrollmentStudent.pensionMonthlyAmounts = normalizePensionMonthlyAmounts(data);
      existingEnrollmentStudent.admissionFee = {
        applies: admissionFee?.applies === true,
        amount: Number(admissionFee?.amount || 0),
        isExempt: admissionFee?.isExempt === true,
        reason: admissionFee?.reason,
      };
      existingEnrollmentStudent.enrollmentFee = {
        amount: Number(data.enrollmentFee?.amount || 0),
        isExempt: data.enrollmentFee?.isExempt === true,
        reason: data.enrollmentFee?.reason,
      };
      existingEnrollmentStudent.previousSchoolType = previousSchoolType;
      existingEnrollmentStudent.previousSchoolName = previousSchoolType === 'OTHER' ? 'EXTERNO' : undefined;
      existingEnrollmentStudent.notes = data.notes || existingEnrollmentStudent.notes;
      existingEnrollmentStudent.agreedBy = createdByUserId;
      existingEnrollmentStudent.agreedAt = new Date();
      await existingEnrollmentStudent.save({ session });
    } else {
      await createEnrollmentStudentSession({
        enrollmentId: enrollment._id,
        studentId: student._id,
        classroomId: classroom._id,
        userId: createdByUserId,
        monthlyAmount: data.monthlyAmount,
        pensionMonthlyAmounts: data.pensionMonthlyAmounts,
        admissionFee,
        enrollmentFee: data.enrollmentFee,
        previousSchoolType,
      }, session);
    }

    const enrollmentStudents = await EnrollmentStudent.find({ enrollmentId: enrollment._id }).select('_id').session(session);
    enrollment.enrollmentStudents = enrollmentStudents.map((row) => row._id);
    enrollment.updatedBy = createdByUserId;
    await enrollment.save({ session });

    return {
      enrollment: {
        id: enrollment._id.toString(),
        studentId: student._id.toString(),
        cycleId: cycle._id.toString(),
        classroomId: classroom._id.toString(),
        status: 'DRAFT',
        createdAt: enrollment.createdAt,
      },
    };
  });

  return result;
}

async function createLegacyEnrollmentService(data, createdByUserId) {
  const result = await runInTransaction(async (session) => {
    const cycle = await Cycle.findById(data.cycleId).session(session);
    if (!cycle) throw new ApiError(404, 'Ciclo no encontrado');
    if (cycle.type !== 'SCHOOL_YEAR') throw new ApiError(400, 'Solo se permiten matrículas en ciclos de año escolar');

    const campus = await Campus.findById(data.campusId).session(session);
    if (!campus) throw new ApiError(404, 'Campus no encontrado');

    const family = new Family({ notes: data.notes || undefined, tutorIds: [], studentIds: [] });
    await family.save({ session });

    const enrollment = new Enrollment({
      familyId: family._id,
      cycleId: data.cycleId,
      campusId: data.campusId,
      studentIds: [],
      status: 'DRAFT',
      createdBy: createdByUserId,
      createdByUserId: createdByUserId,
      originSchool: data.originSchool,
      notes: data.notes || undefined,
    });
    await enrollment.save({ session });

    const enrollmentStudentIds = [];

    for (const stu of data.students) {
      const personDoc = await findOrCreatePersonSession(stu.person, session);
      let student = await Student.findOne({ personId: personDoc._id }).session(session);
      if (!student) {
        student = new Student({
          personId: personDoc._id,
          familyId: family._id,
          internalCode: await nextStudentCodeSession(session),
          activeStatus: 'ACTIVE',
        });
        await student.save({ session });
      } else if (!student.internalCode) {
        student.internalCode = await nextStudentCodeSession(session);
        student.familyId = family._id;
        await student.save({ session });
      }

      family.studentIds.push(student._id);

      for (const tut of stu.tutors) {
        const tutorPerson = await findOrCreatePersonSession(tut.person, session);
        const tutorDoc = new Tutor({
          studentId: student._id,
          tutorPersonId: tutorPerson._id,
          relationship: tut.relationship,
          isPrimary: tut.isPrimary ?? false,
          livesWithStudent: tut.livesWithStudent ?? true,
        });
        await tutorDoc.save({ session });
        family.tutorIds.push(tutorDoc._id);
      }

      const previousSchoolType = derivePreviousSchoolType(student.previousCampus);
      const admissionFee = isOwnCampus(student.previousCampus)
        ? { applies: false, amount: 0, isExempt: true, reason: 'Traslado interno' }
        : (stu.admissionFee || {});

      const enrollmentStudent = await createEnrollmentStudentSession({
        enrollmentId: enrollment._id,
        studentId: student._id,
        classroomId: stu.classroomId,
        userId: createdByUserId,
        monthlyAmount: stu.monthlyAmount,
        pensionMonthlyAmounts: stu.pensionMonthlyAmounts,
        admissionFee,
        enrollmentFee: stu.enrollmentFee,
        previousSchoolType,
      }, session);

      if (stu.notes) enrollmentStudent.notes = stu.notes;
      await enrollmentStudent.save({ session });
      enrollmentStudentIds.push(enrollmentStudent._id);
    }

    enrollment.studentIds = family.studentIds;
    enrollment.enrollmentStudents = enrollmentStudentIds;
    await enrollment.save({ session });
    await family.save({ session });

    return Enrollment.findById(enrollment._id)
      .populate({ path: 'familyId', populate: [
        { path: 'studentIds', populate: { path: 'personId' } },
        { path: 'tutorIds', populate: { path: 'tutorPersonId' } },
      ] })
      .populate('cycleId')
      .populate('campusId')
      .populate({ path: 'enrollmentStudents', populate: [{ path: 'studentId' }, { path: 'classroomId' }] })
      .session(session);
  });

  return result;
}

export async function createEnrollmentService(data, createdByUserId) {
  if (data.studentId) {
    return createQuickEnrollmentService(data, createdByUserId);
  }
  return createLegacyEnrollmentService(data, createdByUserId);
}

export async function getEnrollmentService(id) {
  await runInTransaction(async (session) => {
    await hydrateLegacyEnrollmentStudents(id, session);
  });

  const enrollment = await Enrollment.findById(id)
    .populate({ path: 'familyId', populate: [
      { path: 'studentIds', populate: { path: 'personId' } },
      { path: 'tutorIds', populate: { path: 'tutorPersonId' } },
    ] })
    .populate('cycleId')
    .populate('campusId')
    .populate({ path: 'enrollmentStudents', populate: [{ path: 'studentId', populate: { path: 'personId' } }, { path: 'classroomId' }] });

  if (!enrollment) throw new ApiError(404, 'Matrícula no encontrada');

  return enrollment;
}

export async function getClassroomCapacityService({ classroomId, cycleId }) {
  if (!mongoose.Types.ObjectId.isValid(classroomId)) throw new ApiError(400, 'classroomId inválido');
  if (!mongoose.Types.ObjectId.isValid(cycleId)) throw new ApiError(400, 'cycleId inválido');

  const classroom = await Classroom.findById(classroomId).lean();
  if (!classroom) throw new ApiError(404, 'Salón no encontrado');
  if (String(classroom.cycleId) !== String(cycleId)) throw new ApiError(400, 'El salón no pertenece al ciclo indicado');

  const metrics = await getCapacityForClassroom({
    classroomId: classroom._id,
    cycleId,
    totalCapacity: classroom.capacity,
  });

  return {
    classroomId: classroom._id.toString(),
    totalCapacity: metrics.capacity,
    reservedCount: metrics.occupied,
    availableCount: metrics.available,
  };
}

export async function getCampusCapacityService({ campusId, cycleId }) {
  if (!mongoose.Types.ObjectId.isValid(campusId)) throw new ApiError(400, 'campusId inválido');
  if (!mongoose.Types.ObjectId.isValid(cycleId)) throw new ApiError(400, 'cycleId inválido');

  const classrooms = await Classroom.find({ campusId, cycleId, isActive: true })
    .select('_id level grade section capacity')
    .lean();

  const reservedByClassroom = await Vacancy.aggregate([
    { $match: { cycleId: new mongoose.Types.ObjectId(cycleId) } },
    { $group: { _id: '$classroomId', reservedCount: { $sum: 1 } } },
  ]);

  const reservedMap = new Map(reservedByClassroom.map((entry) => [String(entry._id), entry.reservedCount]));

  return classrooms.map((classroom) => {
    const reservedCount = reservedMap.get(String(classroom._id)) || 0;
    const totalCapacity = classroom.capacity;

    return {
      classroomId: classroom._id.toString(),
      level: classroom.level,
      grade: classroom.grade,
      section: classroom.section,
      totalCapacity,
      reservedCount,
      availableCount: Math.max(totalCapacity - reservedCount, 0),
    };
  });
}

export async function confirmEnrollmentService({ enrollmentId, payload, userId }) {
  const result = await runInTransaction(async (session) => {
    const enrollment = await hydrateLegacyEnrollmentStudents(enrollmentId, session);
    if (!enrollment) throw new ApiError(404, 'Matrícula no encontrada');
    if (enrollment.status === 'CONFIRMED') throw new ApiError(409, 'La matrícula ya fue confirmada');
    if (enrollment.status !== 'DRAFT') throw new ApiError(409, 'El estado actual de matrícula no permite confirmación');

    if (!enrollment.familyId) throw new ApiError(409, 'La matrícula no tiene familia asignada');

    const cycleId = payload.cycleId || enrollment.cycleId;
    const campusId = payload.campusId || enrollment.campusId;

    const cycle = await Cycle.findById(cycleId).session(session);
    if (!cycle) throw new ApiError(404, 'Ciclo no encontrado');

    const campus = await Campus.findById(campusId).session(session);
    if (!campus) throw new ApiError(404, 'Campus no encontrado');

    const enrollmentStudents = await EnrollmentStudent.find({ enrollmentId: enrollment._id }).session(session);
    if (!enrollmentStudents.length) throw new ApiError(409, 'La matrícula no tiene estudiantes para confirmar');

    const enrollmentStudentByStudentId = new Map(enrollmentStudents.map((row) => [String(row.studentId), row]));
    for (const incoming of (payload.students || [])) {
      const row = enrollmentStudentByStudentId.get(String(incoming.studentId));
      if (!row) continue;

      const mergedAdmissionFee = {
        ...(row.admissionFee?.toObject?.() || row.admissionFee || {}),
        ...(incoming.admissionFee || {}),
      };
      const mergedEnrollmentFee = {
        ...(row.enrollmentFee?.toObject?.() || row.enrollmentFee || {}),
        ...(incoming.enrollmentFee || {}),
      };

      row.classroomId = incoming.classroomId || row.classroomId || null;
      row.pensionMonthlyAmounts = normalizePensionMonthlyAmounts(incoming);
      row.admissionFee = {
        applies: mergedAdmissionFee.applies === true,
        amount: Number(mergedAdmissionFee.amount || 0),
        isExempt: mergedAdmissionFee.isExempt === true,
        reason: mergedAdmissionFee.reason,
      };
      row.enrollmentFee = {
        amount: Number(mergedEnrollmentFee.amount || 0),
        isExempt: mergedEnrollmentFee.isExempt === true,
        reason: mergedEnrollmentFee.reason,
      };
      row.notes = incoming.notes || row.notes;
      row.agreedBy = userId;
      row.agreedAt = new Date();
      await row.save({ session });
    }

    const allEnrollmentStudents = await EnrollmentStudent.find({ enrollmentId: enrollment._id }).session(session);
    const studentIds = allEnrollmentStudents.map((row) => row.studentId);

    const dedup = new Set(studentIds.map((id) => String(id)));
    if (dedup.size !== studentIds.length) throw new ApiError(409, 'La matrícula contiene estudiantes duplicados');

    const students = await Student.find({ _id: { $in: studentIds } })
      .populate('personId')
      .select('_id personId internalCode previousCampus')
      .session(session);
    if (students.length !== studentIds.length) throw new ApiError(409, 'Hay estudiantes inválidos para confirmar');

    const studentsById = new Map(students.map((row) => [String(row._id), row]));

    const classroomIds = [...new Set(allEnrollmentStudents.map((row) => String(row.classroomId)).filter(Boolean))]
      .map((id) => new mongoose.Types.ObjectId(id));
    const classrooms = await Classroom.find({ _id: { $in: classroomIds } })
      .select('_id displayName cycleId campusId')
      .session(session)
      .lean();
    const classroomsById = new Map(classrooms.map((row) => [String(row._id), row]));

    for (const row of allEnrollmentStudents) {
      if (!row.classroomId) throw new ApiError(409, 'Todos los alumnos deben tener aula para confirmar');
      if (!Array.isArray(row.pensionMonthlyAmounts) || row.pensionMonthlyAmounts.length !== SCHOOL_MONTHS) {
        throw new ApiError(409, 'Costos de pensión inválidos en la matrícula');
      }

      const student = studentsById.get(String(row.studentId));
      if (!student?.personId?.names) throw new ApiError(409, 'Hay alumnos sin datos base para confirmar');

      const classroom = classroomsById.get(String(row.classroomId));
      if (!classroom) throw new ApiError(409, 'Hay aulas inválidas en la matrícula');

      if (String(classroom.cycleId) !== String(cycleId)) {
        throw new ApiError(409, 'El aula seleccionada no corresponde al ciclo de la matrícula');
      }

      if (String(classroom.campusId) !== String(campusId)) {
        throw new ApiError(409, 'El aula seleccionada no corresponde al campus de la matrícula');
      }

      row.previousSchoolType = derivePreviousSchoolType(student.previousCampus);
      row.previousSchoolName = row.previousSchoolType === 'OTHER' ? 'EXTERNO' : undefined;

      if (isOwnCampus(student.previousCampus)) {
        row.admissionFee = {
          applies: false,
          amount: 0,
          isExempt: true,
          reason: 'Traslado interno',
        };
      }

      await row.save({ session });

      await upsertStudentCycleForEnrollment({
        studentId: row.studentId,
        cycleId,
        campusId,
        enrollmentId: enrollment._id,
        session,
      });

      await Vacancy.updateOne(
        { studentId: row.studentId, cycleId },
        {
          $setOnInsert: { studentId: row.studentId, cycleId },
          $set: { classroomId: row.classroomId },
        },
        { upsert: true, session }
      );
    }

    const { byCode, missingCodes } = await resolveBillingConceptsByCode({
      session,
      requiredCodes: ['ENROLLMENT_FEE', 'ADMISSION_FEE', 'TUITION'],
    });
    if (missingCodes.length) {
      throw new ApiError(409, `Faltan BillingConcept requeridos: ${missingCodes.join(', ')}`);
    }

    const chargesToCreate = [];
    for (const row of allEnrollmentStudents) {
      const student = studentsById.get(String(row.studentId));

      const admissionCharge = buildAdmissionFeeCharge({
        enrollmentStudent: row,
        student,
        conceptId: byCode.get('ADMISSION_FEE'),
        cycleId,
        campusId,
      });
      if (admissionCharge) chargesToCreate.push(admissionCharge);

      const enrollmentCharge = buildEnrollmentFeeCharge({
        enrollmentStudent: row,
        conceptId: byCode.get('ENROLLMENT_FEE'),
        cycleId,
        campusId,
      });
      if (enrollmentCharge) chargesToCreate.push(enrollmentCharge);

      const tuitionCharges = buildTuitionCharges({
        enrollmentStudent: row,
        conceptId: byCode.get('TUITION'),
        cycleId,
        campusId,
      });
      chargesToCreate.push(...tuitionCharges);

      row.chargesGeneratedAt = new Date();
      await row.save({ session });
    }

    if (chargesToCreate.length) {
      await Charge.insertMany(chargesToCreate, { session });
    }

    const snapshotData = buildContractSnapshot({
      enrollment: { ...enrollment.toObject(), cycleId, campusId },
      enrollmentStudents: allEnrollmentStudents,
      studentsById,
      classroomsById,
      userId,
      notes: payload.notes,
    });

    const snapshot = await ContractSnapshot.findOne({ $or: [{ enrollmentId: enrollment._id }, { matriculaId: enrollment._id }] }).session(session);
    if (!snapshot) {
      await new ContractSnapshot(snapshotData).save({ session });
    } else {
      await ContractSnapshot.updateOne({ _id: snapshot._id }, { $set: snapshotData }, { session });
    }

    await Enrollment.updateOne(
      { _id: enrollment._id },
      {
        $set: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          cycleId,
          campusId,
          studentIds,
          enrollmentStudents: allEnrollmentStudents.map((row) => row._id),
          updatedBy: userId,
        },
      },
      { session }
    );

    return {
      enrollmentId: enrollment._id.toString(),
      campusId: String(campusId),
      status: 'CONFIRMED',
      snapshotSaved: true,
      chargesCreated: chargesToCreate.length,
    };
  });

  await registerAuditLog({
    entityType: 'ENROLLMENT',
    entityId: result.enrollmentId,
    action: 'ENROLLMENT_CONFIRMED',
    performedBy: userId,
    campusId: result.campusId,
    payloadSnapshot: { students: payload.students?.length || 0, hasNotes: Boolean(payload.notes) },
  });

  return {
    enrollmentId: result.enrollmentId,
    status: result.status,
    snapshotSaved: result.snapshotSaved,
    chargesCreated: result.chargesCreated,
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toObjectIdOrNull(value) {
  if (!value) return null;
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : null;
}

export { buildSearchScore };

export async function intakeSearchService({ q, campusScope, limit = 20 }) {
  const normalizedLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  const trimmedQ = String(q || '').trim();

  console.log('[IntakeSearch][REQ]', { q: trimmedQ, campusScope, limit: normalizedLimit });

  // Antes fallaba por varios factores combinados:
  // - $lookup manual sensible a nombre real de colección de Person (person/people).
  // - $limit prematuro antes de score/filtro por campus, recortando coincidencias relevantes.
  // - dependencia estricta de ciclo activo que bloqueaba toda la búsqueda.
  const data = await intakeSearch({ q: trimmedQ, campusScope, limit: normalizedLimit });

  console.log('[IntakeSearch][RES]', {
    q: trimmedQ,
    campusScope,
    total: data.items.length,
    families: data.items.filter((item) => item.type === 'FAMILY').length,
    students: data.items.filter((item) => item.type === 'STUDENT').length,
  });

  return data;
}

export async function listEnrollmentsService({ q, campus, cycleId, status, classroomId, limit = 20, cursor, campusScope = [] }) {
  const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const where = {};

  const isGlobalScope = Array.isArray(campusScope) && campusScope.includes('ALL');
  if (!isGlobalScope && Array.isArray(campusScope) && campusScope.length) {
    const scopedCampuses = await Campus.find({ code: { $in: campusScope } }).select('_id code').lean();

    const scopeCampusIds = new Set(scopedCampuses.map((row) => String(row._id)));
    const scopeCampusCodes = new Set(scopedCampuses.map((row) => row.code));

    if (campus) {
      const normalizedCampus = String(campus);
      if (!scopeCampusCodes.has(normalizedCampus)) throw new ApiError(403, 'No autorizado para este campus');
    } else {
      where.campusId = { $in: [...scopeCampusIds].map((id) => new mongoose.Types.ObjectId(id)) };
      if (!scopeCampusIds.size) return { items: [], nextCursor: null };
    }
  }

  if (cycleId) where.cycleId = cycleId;
  if (campus) {
    const campusDoc = await Campus.findOne({ $or: [{ _id: toObjectIdOrNull(campus) || null }, { code: campus }] }).select('_id').lean();
    if (!campusDoc) return { items: [], nextCursor: null };
    where.campusId = campusDoc._id;
  }
  if (cursor) where._id = { $gt: cursor };

  let qStudentIds = null;
  if (q) {
    const regex = new RegExp(escapeRegExp(String(q).trim()), 'i');
    const matchedPeople = await Person.find({ dni: regex }).select('_id').lean();
    const matchedStudents = await Student.find({
      $or: [
        { internalCode: regex },
        ...(matchedPeople.length ? [{ personId: { $in: matchedPeople.map((p) => p._id) } }] : []),
      ],
    }).select('_id').lean();

    if (!matchedStudents.length) return { items: [], nextCursor: null };
    qStudentIds = new Set(matchedStudents.map((row) => String(row._id)));
  }

  const rows = await Enrollment.find(where)
    .sort({ _id: 1 })
    .limit(normalizedLimit + 1)
    .select('_id studentIds enrollmentStudents cycleId campusId status createdAt')
    .lean();

  const hasMore = rows.length > normalizedLimit;
  const selected = hasMore ? rows.slice(0, normalizedLimit) : rows;

  const enrollmentIds = selected.map((row) => row._id);
  const enrollmentStudents = await EnrollmentStudent.find({ enrollmentId: { $in: enrollmentIds } })
    .select('enrollmentId studentId classroomId pensionMonthlyAmounts')
    .lean();

  const enrollmentStudentsByEnrollment = new Map();
  for (const row of enrollmentStudents) {
    const key = String(row.enrollmentId);
    if (!enrollmentStudentsByEnrollment.has(key)) enrollmentStudentsByEnrollment.set(key, []);
    enrollmentStudentsByEnrollment.get(key).push(row);
  }

  const allStudentIds = [...new Set([
    ...selected.flatMap((row) => (row.studentIds || []).map((id) => String(id))),
    ...enrollmentStudents.map((row) => String(row.studentId)),
  ])].map((id) => new mongoose.Types.ObjectId(id));

  const [students, cycles, classrooms, studentCycles, snapshots] = await Promise.all([
    Student.find({ _id: { $in: allStudentIds } }).populate('personId').select('_id internalCode personId').lean(),
    Cycle.find({ _id: { $in: [...new Set(selected.map((row) => String(row.cycleId)))] } }).select('_id name').lean(),
    Vacancy.find({ studentId: { $in: allStudentIds }, ...(classroomId ? { classroomId } : {}) })
      .populate('classroomId', '_id displayName')
      .select('studentId cycleId classroomId')
      .lean(),
    StudentCycle.find({ studentId: { $in: allStudentIds }, ...(cycleId ? { cycleId } : {}), ...(status ? { status } : {}) })
      .select('studentId cycleId status')
      .lean(),
    ContractSnapshot.find({ $or: [{ enrollmentId: { $in: enrollmentIds } }, { matriculaId: { $in: enrollmentIds } }] })
      .select('enrollmentId matriculaId students discounts notes confirmedAt')
      .lean(),
  ]);

  const studentsMap = new Map(students.map((s) => [String(s._id), s]));
  const cycleMap = new Map(cycles.map((c) => [String(c._id), c]));
  const snapshotMap = new Map(snapshots.map((s) => [String(s.enrollmentId || s.matriculaId), s]));
  const cycleStatusMap = new Map(studentCycles.map((c) => [`${String(c.studentId)}:${String(c.cycleId)}`, c.status]));
  const classroomMap = new Map(classrooms.map((c) => [`${String(c.studentId)}:${String(c.cycleId)}`, c.classroomId]));

  const items = [];
  for (const row of selected) {
    const cycle = cycleMap.get(String(row.cycleId));
    const snapshot = snapshotMap.get(String(row._id));
    const enrollmentRows = enrollmentStudentsByEnrollment.get(String(row._id)) || [];
    const studentIds = enrollmentRows.length
      ? enrollmentRows.map((entry) => entry.studentId)
      : (row.studentIds || []);

    for (const studentIdItem of studentIds) {
      if (qStudentIds && !qStudentIds.has(String(studentIdItem))) continue;

      const student = studentsMap.get(String(studentIdItem));
      if (!student) continue;

      const statusValue = cycleStatusMap.get(`${String(studentIdItem)}:${String(row.cycleId)}`) || 'ABSENT';
      if (status && statusValue !== status) continue;

      const classroom = classroomMap.get(`${String(studentIdItem)}:${String(row.cycleId)}`);
      if (classroomId && String(classroom?._id || classroom) !== String(classroomId)) continue;

      const enrollmentStudent = enrollmentRows.find((entry) => String(entry.studentId) === String(studentIdItem));
      const snapshotStudent = snapshot?.students?.find((entry) => String(entry.studentId) === String(studentIdItem));
      const pensionMonthlyAmounts = enrollmentStudent?.pensionMonthlyAmounts || snapshotStudent?.pensionMonthlyAmounts || normalizePensionMonthlyAmounts(snapshotStudent || {});

      items.push({
        enrollmentId: row._id.toString(),
        student: {
          id: student._id.toString(),
          names: student.personId?.names || null,
          lastNames: student.personId?.lastNames || null,
          dni: student.personId?.dni || null,
          code: student.internalCode || null,
        },
        campus: row.campusId?.toString(),
        cycle: cycle ? { id: cycle._id.toString(), name: cycle.name } : null,
        classroom: classroom ? { id: classroom._id.toString(), displayName: classroom.displayName } : null,
        status: statusValue,
        confirmedAt: snapshot?.confirmedAt || null,
        snapshot: {
          monthlyFee: firstApplicablePensionAmount(pensionMonthlyAmounts),
          pensionMonthlyAmounts,
          discount: snapshot?.discounts || null,
          notes: snapshot?.notes || null,
        },
      });
    }
  }

  return {
    items: items.slice(0, normalizedLimit),
    nextCursor: hasMore ? selected[selected.length - 1]._id.toString() : null,
  };
}
