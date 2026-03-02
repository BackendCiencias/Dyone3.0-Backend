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
import { Cycle } from '../../models/cycle.model.js';
import { Campus } from '../../models/campus.model.js';
import { Classroom } from '../../models/classroom.model.js';
import { StudentCycle } from '../../models/studentCycle.model.js';
import { Counter } from '../../models/counter.model.js';
import { ApiError } from '../../utils/errors.js';
import { runInTransaction } from '../../shared/dbSession.js';
import { registerAuditLog } from '../../shared/audit.service.js';

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

async function createEnrollmentStudentSession({ enrollmentId, studentId, classroomId, userId, monthlyAmount }, session) {
  const enrollmentStudent = new EnrollmentStudent({
    enrollmentId,
    studentId,
    classroomId: classroomId || null,
    agreedBy: userId,
    agreedAt: new Date(),
    pensionMonthlyAmounts: normalizePensionMonthlyAmounts({ monthlyAmount }),
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
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const student = await Student.findById(data.studentId).session(session);
    if (!student) throw new ApiError(404, 'Estudiante no encontrado');

    const cycle = await Cycle.findById(data.cycleId).session(session);
    if (!cycle) throw new ApiError(404, 'Ciclo no encontrado');

    const classroom = await Classroom.findById(data.classroomId).session(session);
    if (!classroom) throw new ApiError(404, 'Classroom no encontrado');

    if (!student.familyId) throw new ApiError(400, 'El estudiante no tiene familia vinculada');

    const existing = await Enrollment.findOne({
      cycleId: cycle._id,
      studentIds: student._id,
      status: 'CONFIRMED',
    }).session(session);

    if (existing) throw new ApiError(409, 'El estudiante ya tiene matrícula confirmada en este ciclo');

    const enrollment = new Enrollment({
      familyId: student.familyId,
      cycleId: cycle._id,
      campusId: classroom.campusId,
      studentIds: [student._id],
      enrolledAt: new Date(),
      status: 'CONFIRMED',
      confirmedAt: new Date(),
      createdBy: createdByUserId,
      createdByUserId: createdByUserId,
      originSchool: data.source,
      notes: data.notes || undefined,
    });

    await enrollment.save({ session });

    const enrollmentStudent = await createEnrollmentStudentSession({
      enrollmentId: enrollment._id,
      studentId: student._id,
      classroomId: classroom._id,
      userId: createdByUserId,
    }, session);

    await Enrollment.updateOne({ _id: enrollment._id }, { $set: { enrollmentStudents: [enrollmentStudent._id] } }, { session });

    await Vacancy.updateOne(
      { studentId: student._id, cycleId: cycle._id },
      {
        $setOnInsert: {
          studentId: student._id,
          cycleId: cycle._id,
        },
        $set: {
          classroomId: classroom._id,
          notes: data.notes || undefined,
        },
      },
      { upsert: true, session }
    );

    await StudentCycle.updateOne(
      { studentId: student._id, cycleId: cycle._id, campusId: classroom.campusId },
      {
        $set: {
          status: 'ENROLLED',
          enrolledAt: new Date(),
          enrollmentId: enrollment._id,
          notes: data.notes || undefined,
        },
      },
      { upsert: true, session }
    );

    await session.commitTransaction();

    return {
      enrollment: {
        id: enrollment._id.toString(),
        studentId: student._id.toString(),
        cycleId: cycle._id.toString(),
        classroomId: classroom._id.toString(),
        status: 'CONFIRMED',
        createdAt: enrollment.enrolledAt,
      },
    };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

async function createLegacyEnrollmentService(data, createdByUserId) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const cycle = await Cycle.findById(data.cycleId).session(session);
    if (!cycle) throw new ApiError(404, 'Ciclo no encontrado');
    if (cycle.type !== 'SCHOOL_YEAR') throw new ApiError(400, 'Solo se permiten matrículas en ciclos de año escolar');

    const campus = await Campus.findById(data.campusId).session(session);
    if (!campus) throw new ApiError(404, 'Campus no encontrado');

    const family = new Family({ notes: data.notes || undefined, tutorIds: [], studentIds: [] });
    await family.save({ session });

    const enrollmentStudents = [];
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

      await Vacancy.updateOne(
        { studentId: student._id, cycleId: data.cycleId },
        {
          $setOnInsert: {
            studentId: student._id,
            cycleId: data.cycleId,
          },
          $set: { classroomId: stu.classroomId },
        },
        { upsert: true, session }
      );

      if (stu.charges) {
        for (const ch of stu.charges) {
          const charge = new Charge({
            studentId: student._id,
            cycleId: data.cycleId,
            conceptId: ch.conceptId,
            description: ch.description,
            totalAmount: mongoose.Types.Decimal128.fromString(ch.amount.toString()),
            outstandingAmount: mongoose.Types.Decimal128.fromString(ch.amount.toString()),
            dueDate: ch.dueDate ? new Date(ch.dueDate) : undefined,
            status: 'OPEN',
          });
          await charge.save({ session });
        }
      }

      enrollmentStudents.push({ studentId: student._id, classroomId: stu.classroomId });
    }

    await family.save({ session });

    const enrollment = new Enrollment({
      familyId: family._id,
      cycleId: data.cycleId,
      campusId: data.campusId,
      studentIds: family.studentIds,
      enrolledAt: new Date(),
      status: 'CONFIRMED',
      confirmedAt: new Date(),
      createdBy: createdByUserId,
      createdByUserId: createdByUserId,
      originSchool: data.originSchool,
      notes: data.notes || undefined,
    });
    await enrollment.save({ session });

    const enrollmentStudentIds = [];
    for (const row of enrollmentStudents) {
      const enrollmentStudent = await createEnrollmentStudentSession({
        enrollmentId: enrollment._id,
        studentId: row.studentId,
        classroomId: row.classroomId,
        userId: createdByUserId,
      }, session);
      enrollmentStudentIds.push(enrollmentStudent._id);
    }

    await Enrollment.updateOne({ _id: enrollment._id }, { $set: { enrollmentStudents: enrollmentStudentIds } }, { session });

    const contractSnapshot = new ContractSnapshot({
      enrollmentId: enrollment._id,
      matriculaId: enrollment._id,
      contractNumber: data.contractNumber,
      createdAt: new Date(),
      isSigned: false,
    });
    await contractSnapshot.save({ session });

    await session.commitTransaction();

    return Enrollment.findById(enrollment._id)
      .populate({ path: 'familyId', populate: [
        { path: 'studentIds', populate: { path: 'personId' } },
        { path: 'tutorIds', populate: { path: 'tutorPersonId' } },
      ] })
      .populate('cycleId')
      .populate('campusId')
      .populate({ path: 'enrollmentStudents', populate: [{ path: 'studentId' }, { path: 'classroomId' }] });
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
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

    const cycle = await Cycle.findById(payload.cycleId).session(session);
    if (!cycle) throw new ApiError(404, 'Ciclo no encontrado');

    const campus = await Campus.findById(payload.campusId).session(session);
    if (!campus) throw new ApiError(404, 'Campus no encontrado');

    const studentIds = payload.students.map((row) => row.studentId);
    const studentCount = await Student.countDocuments({ _id: { $in: studentIds } }).session(session);
    if (studentCount !== studentIds.length) throw new ApiError(404, 'Hay estudiantes que no existen');

    const enrollmentStudents = await EnrollmentStudent.find({ enrollmentId: enrollment._id, studentId: { $in: studentIds } }).session(session);
    const enrollmentStudentByStudentId = new Map(enrollmentStudents.map((row) => [String(row.studentId), row]));

    for (const row of payload.students) {
      const current = enrollmentStudentByStudentId.get(String(row.studentId));
      if (current) {
        current.pensionMonthlyAmounts = normalizePensionMonthlyAmounts(row);
        current.classroomId = row.classroomId || current.classroomId || null;
        current.agreedBy = userId;
        current.agreedAt = new Date();
        current.notes = row.notes || current.notes;
        await current.save({ session });
      } else {
        const created = new EnrollmentStudent({
          enrollmentId: enrollment._id,
          studentId: row.studentId,
          classroomId: row.classroomId || null,
          agreedBy: userId,
          agreedAt: new Date(),
          notes: row.notes,
          pensionMonthlyAmounts: normalizePensionMonthlyAmounts(row),
        });
        await created.save({ session });
      }

      await StudentCycle.findOneAndUpdate(
        { studentId: row.studentId, cycleId: payload.cycleId, campusId: payload.campusId },
        {
          $set: { status: 'ENROLLED', enrolledAt: new Date(), enrollmentId: enrollment._id },
          $setOnInsert: { studentId: row.studentId, cycleId: payload.cycleId, campusId: payload.campusId },
        },
        { upsert: true, new: true, session }
      );
    }

    const allEnrollmentStudents = await EnrollmentStudent.find({ enrollmentId: enrollment._id }).select('_id studentId pensionMonthlyAmounts').session(session);

    const snapshotStudents = allEnrollmentStudents.map((entry) => ({
      studentId: entry.studentId,
      monthlyAmount: firstApplicablePensionAmount(entry.pensionMonthlyAmounts) ?? 0,
      pensionMonthlyAmounts: entry.pensionMonthlyAmounts,
    }));

    const snapshotData = {
      enrollmentId: enrollment._id,
      matriculaId: enrollment._id,
      cycleId: payload.cycleId,
      campusId: payload.campusId,
      students: snapshotStudents,
      discounts: payload.discounts || undefined,
      exemptions: payload.exemptions || undefined,
      notes: payload.notes || undefined,
      confirmedByUserId: userId,
      confirmedAt: new Date(),
    };

    const snapshot = await ContractSnapshot.findOne({ $or: [{ enrollmentId: enrollment._id }, { matriculaId: enrollment._id }] }).session(session);
    if (!snapshot) {
      await new ContractSnapshot(snapshotData).save({ session });
    } else {
      await ContractSnapshot.updateOne({ _id: snapshot._id }, { $set: snapshotData }, { session });
    }

    const enrollmentStudentIds = allEnrollmentStudents.map((row) => row._id);

    await Enrollment.updateOne(
      { _id: enrollment._id },
      {
        $set: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          enrolledAt: enrollment.enrolledAt || new Date(),
          cycleId: payload.cycleId,
          campusId: payload.campusId,
          enrollmentStudents: enrollmentStudentIds,
          updatedBy: userId,
        },
      },
      { session }
    );

    return {
      enrollmentId: enrollment._id.toString(),
      campusId: enrollment.campusId,
      status: 'CONFIRMED',
      snapshotSaved: true,
      chargeGenerationPending: true,
    };
  });

  await registerAuditLog({
    entityType: 'ENROLLMENT',
    entityId: result.enrollmentId,
    action: 'ENROLLMENT_CONFIRMED',
    performedBy: userId,
    campusId: result.campusId,
    payloadSnapshot: payload,
  });

  return {
    enrollmentId: result.enrollmentId,
    status: result.status,
    snapshotSaved: result.snapshotSaved,
    chargeGenerationPending: result.chargeGenerationPending,
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toObjectIdOrNull(value) {
  if (!value) return null;
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : null;
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
