import mongoose from 'mongoose';
import { Student } from '../../models/student.model.js';
import { Person } from '../../models/person.model.js';
import { Tutor } from '../../models/tutor.model.js';
import { Counter } from '../../models/counter.model.js';
import { Enrollment } from '../../models/enrollment.model.js';
import { EnrollmentStudent, NO_APLICA_PENSION } from '../../models/enrollmentStudent.model.js';
import { Vacancy } from '../../models/vacancy.model.js';
import { getCapacityForClassroom } from './services/enrollmentsCapacity.service.js';
import { ContractSnapshot } from '../../models/contractSnapshot.model.js';
import { Charge } from '../../models/charge.model.js';
import { BillingSchedule } from '../../models/billingSchedule.model.js';
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
import { ApiError } from '../../utils/errors.js';
import { runInTransaction } from '../../shared/dbSession.js';
import { registerAuditLog } from '../../shared/audit.service.js';
import { buildSearchScore } from '../../utils/search.js';
import { normalizePersonNameFields } from '../../utils/personNameFormatter.js';

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

function normalizeDni(dni) {
  const normalized = String(dni || '').trim();
  if (!normalized) return undefined;
  const lowered = normalized.toLowerCase();
  if (['null', 'undefined', 'n/a', 'na', '-'].includes(lowered)) return undefined;
  return normalized;
}

function normalizePhone(value) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  return normalized || undefined;
}

function mapTutorRelationship(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const map = {
    padre: 'Padre',
    madre: 'Madre',
    abuelo: 'Abuelo',
    abuela: 'Abuela',
    hermano: 'Hermano',
    hermana: 'Hermana',
    tio: 'Tío',
    tío: 'Tío',
    tia: 'Tía',
    tía: 'Tía',
    apoderado: 'Apoderado',
    tutor: 'Apoderado',
    otro: 'Otro',
  };

  return map[normalized] || 'Apoderado';
}

function toNumber(value, fallback = 0) {
  const numberValue = Number(value ?? fallback);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function normalizeFee(fee = {}, { includesApplies = false } = {}) {
  const base = {
    amount: toNumber(fee.amount, 0),
    isExempt: fee.isExempt === true,
    reason: fee.reason || '',
  };

  return includesApplies
    ? { ...base, applies: fee.applies === true }
    : base;
}

function buildChargePayload({ studentId, cycleId, campusId, conceptId, concept, amount, monthIndex = null, dueDate = null, notes = '' }) {
  const decimalAmount = mongoose.Types.Decimal128.fromString(String(amount));

  return {
    studentId,
    cycleId,
    campusId,
    conceptId,
    concept,
    monthIndex,
    description: concept,
    totalAmount: decimalAmount,
    outstandingAmount: decimalAmount,
    dueDate,
    notes,
  };
}

function buildChargeConflictKey({ studentId, cycleId, concept, monthIndex = null }) {
  return `${String(studentId)}:${String(cycleId)}:${String(concept)}:${monthIndex ?? 'NONE'}`;
}

function groupSchedulesByConcept(schedules = []) {
  const grouped = new Map();
  for (const row of schedules) {
    const key = row.conceptCode;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return grouped;
}

function sortSchedulesByMonth(rows = []) {
  return [...rows].sort((a, b) => {
    if (a.monthIndex === null && b.monthIndex === null) return 0;
    if (a.monthIndex === null) return 1;
    if (b.monthIndex === null) return -1;
    return a.monthIndex - b.monthIndex;
  });
}

function getConceptDueDate(schedulesByConcept, conceptCode, fallback = new Date()) {
  const rows = sortSchedulesByMonth(schedulesByConcept.get(conceptCode) || []);
  return rows[0]?.dueDate || fallback;
}

function getTuitionDueDatesByMonth(schedulesByConcept) {
  return new Map(
    sortSchedulesByMonth(schedulesByConcept.get('TUITION') || [])
      .filter((row) => row.monthIndex !== null && row.monthIndex !== undefined)
      .map((row) => [row.monthIndex, row.dueDate])
  );
}

async function loadBillingSetup({ session, cycleId }) {
  const { byCode, missingCodes } = await resolveBillingConceptsByCode({
    session,
    requiredCodes: ['ADMISSION_FEE', 'ENROLLMENT_FEE', 'TUITION'],
  });
  if (missingCodes.length) {
    throw new ApiError(409, `Faltan BillingConcept requeridos: ${missingCodes.join(', ')}`);
  }

  const schedules = await BillingSchedule.find({
    cycleId,
    conceptCode: { $in: ['TUITION', 'ADMISSION_FEE', 'ENROLLMENT_FEE'] },
  }).session(session);

  const schedulesByConcept = groupSchedulesByConcept(schedules);
  const tuitionDueDatesByMonth = getTuitionDueDatesByMonth(schedulesByConcept);
  if (!tuitionDueDatesByMonth.size) {
    throw new ApiError(409, 'No existe calendario de vencimientos para TUITION en este ciclo');
  }

  return {
    byCode,
    schedulesByConcept,
    tuitionDueDatesByMonth,
    admissionDueDate: getConceptDueDate(schedulesByConcept, 'ADMISSION_FEE'),
    enrollmentDueDate: getConceptDueDate(schedulesByConcept, 'ENROLLMENT_FEE'),
  };
}

async function ensureNoDuplicateCharges({ session, charges = [], cycleId }) {
  if (!charges.length) return;

  const candidateKeys = new Set(charges.map((charge) => buildChargeConflictKey(charge)));
  const studentIds = [...new Set(charges.map((charge) => String(charge.studentId)))].map((id) => new mongoose.Types.ObjectId(id));
  const concepts = [...new Set(charges.map((charge) => charge.concept))];

  const existingCharges = await Charge.find({
    studentId: { $in: studentIds },
    cycleId,
    concept: { $in: concepts },
  })
    .select('studentId cycleId concept monthIndex')
    .session(session)
    .lean();

  const duplicated = existingCharges.find((charge) => candidateKeys.has(buildChargeConflictKey(charge)));
  if (duplicated) {
    throw new ApiError(409, 'Ya existen cargos para uno o más estudiantes en el ciclo seleccionado');
  }
}

async function ensureClassroomCapacityForRows({ session, cycleId, enrollmentStudents, classroomsById }) {
  if (!enrollmentStudents.length) return;

  const studentIds = [...new Set(enrollmentStudents.map((row) => String(row.studentId)))].map((id) => new mongoose.Types.ObjectId(id));
  const currentVacancies = await Vacancy.find({
    studentId: { $in: studentIds },
    cycleId,
  })
    .select('studentId classroomId')
    .session(session)
    .lean();

  const currentVacancyByStudent = new Map(currentVacancies.map((row) => [String(row.studentId), row]));
  const targetClassroomIds = [...new Set(enrollmentStudents.map((row) => String(row.classroomId)).filter(Boolean))];

  for (const classroomId of targetClassroomIds) {
    const classroom = classroomsById.get(String(classroomId));
    if (!classroom) throw new ApiError(409, 'Hay aulas inválidas en la matrícula');

    const occupied = await Vacancy.countDocuments({
      classroomId: classroom._id,
      cycleId,
    }).session(session);

    const incomingRows = enrollmentStudents.filter((row) => String(row.classroomId) === String(classroomId));
    const carryOverCount = incomingRows.reduce((acc, row) => {
      const current = currentVacancyByStudent.get(String(row.studentId));
      return acc + (current && String(current.classroomId) === String(classroomId) ? 1 : 0);
    }, 0);

    const projectedOccupied = occupied - carryOverCount + incomingRows.length;
    if (projectedOccupied > Number(classroom.capacity || 0)) {
      throw new ApiError(409, `No hay vacantes disponibles en el aula ${classroom.displayName || classroom._id}`);
    }
  }
}

async function nextStudentCode(session) {
  const counter = await Counter.findOneAndUpdate(
    { key: 'student_internal_code' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session }
  );

  return `COD${String(counter.seq).padStart(6, '0')}`;
}

async function resolveOrCreatePersonDraft(personData, session) {
  const normalizedPerson = normalizePersonNameFields(personData || {});
  const dni = normalizeDni(normalizedPerson.dni);

  let person = null;
  if (dni) {
    person = await Person.findOne({ dni }).session(session);
  }

  if (!person) {
    person = new Person({
      names: normalizedPerson.names,
      lastNames: normalizedPerson.lastNames,
      gender: normalizedPerson.gender || 'M',
      ...(dni ? { dni } : {}),
      ...(normalizePhone(normalizedPerson.phone) ? { phone: normalizePhone(normalizedPerson.phone) } : {}),
    });
    await person.save({ session });
    return person;
  }

  const setUpdates = {};
  if (normalizedPerson.names && normalizedPerson.names !== person.names) setUpdates.names = normalizedPerson.names;
  if (normalizedPerson.lastNames && normalizedPerson.lastNames !== person.lastNames) setUpdates.lastNames = normalizedPerson.lastNames;
  if (normalizedPerson.gender && normalizedPerson.gender !== person.gender) setUpdates.gender = normalizedPerson.gender;
  const phone = normalizePhone(normalizedPerson.phone);
  if (phone && phone !== person.phone) setUpdates.phone = phone;

  if (Object.keys(setUpdates).length) {
    await Person.updateOne({ _id: person._id }, { $set: setUpdates }, { session });
    person = await Person.findById(person._id).session(session);
  }

  return person;
}

async function createConfirmedEnrollmentInSession({ session, data, createdByUserId, allowMultiCampus = false }) {
  const cycle = await Cycle.findById(data.cycleId).session(session);
  if (!cycle) throw new ApiError(404, 'Ciclo no encontrado');

  const studentIds = data.enrollmentStudents.map((row) => String(row.studentId));
  const uniqueStudentIds = [...new Set(studentIds)];
  if (uniqueStudentIds.length !== studentIds.length) {
    throw new ApiError(400, 'No se permiten estudiantes duplicados en enrollmentStudents');
  }

  const students = await Student.find({ _id: { $in: uniqueStudentIds } })
    .populate('personId')
    .select('_id personId internalCode previousCampus')
    .session(session);
  if (students.length !== uniqueStudentIds.length) {
    throw new ApiError(404, 'Uno o más estudiantes no existen');
  }
  const studentsById = new Map(students.map((student) => [String(student._id), student]));

  const classroomIds = [...new Set(data.enrollmentStudents.map((row) => String(row.classroomId)))];
  const classrooms = await Classroom.find({ _id: { $in: classroomIds } })
    .select('_id displayName cycleId campusId capacity')
    .session(session)
    .lean();
  const classroomsById = new Map(classrooms.map((classroom) => [String(classroom._id), classroom]));
  const campusIdsFromClassrooms = [...new Set(classrooms.map((classroom) => String(classroom.campusId)).filter(Boolean))];

  let campus = null;
  if (allowMultiCampus) {
    if (!campusIdsFromClassrooms.length) throw new ApiError(400, 'No se pudo determinar campus de la matrícula');
    campus = await Campus.findById(campusIdsFromClassrooms[0]).session(session);
    if (!campus) throw new ApiError(404, 'Campus principal no encontrado');
  } else {
    campus = await Campus.findById(data.campusId).session(session);
    if (!campus) throw new ApiError(404, 'Campus no encontrado');
  }

  for (const row of data.enrollmentStudents) {
    const classroom = classroomsById.get(String(row.classroomId));
    if (!classroom) throw new ApiError(404, `Aula no encontrada: ${row.classroomId}`);
    if (!allowMultiCampus && String(classroom.campusId) !== String(campus._id)) {
      throw new ApiError(400, `El aula ${row.classroomId} no pertenece al campus indicado`);
    }
    if (String(classroom.cycleId) !== String(cycle._id)) {
      throw new ApiError(400, `El aula ${row.classroomId} no pertenece al ciclo indicado`);
    }
  }

  await ensureClassroomCapacityForRows({
    session,
    cycleId: cycle._id,
    enrollmentStudents: data.enrollmentStudents,
    classroomsById,
  });

  const existingEnrollmentStudents = await EnrollmentStudent.find({
    studentId: { $in: uniqueStudentIds },
  })
    .populate({ path: 'enrollmentId', select: 'cycleId' })
    .session(session);

  for (const row of existingEnrollmentStudents) {
    if (String(row.enrollmentId?.cycleId) === String(cycle._id)) {
      throw new ApiError(409, `El estudiante ${row.studentId} ya tiene matrícula en este ciclo`);
    }
  }

  const enrollment = await Enrollment.create([{
    campusId: campus._id,
    campusIds: allowMultiCampus
      ? campusIdsFromClassrooms.map((id) => new mongoose.Types.ObjectId(id))
      : [campus._id],
    cycleId: cycle._id,
    status: 'CONFIRMED',
    notes: data.notes || undefined,
    createdBy: createdByUserId,
    updatedBy: createdByUserId,
    confirmedAt: new Date(),
  }], { session }).then((docs) => docs[0]);

  const enrollmentStudentDocs = [];
  const chargesToCreate = [];
  const {
    byCode,
    tuitionDueDatesByMonth,
    admissionDueDate,
    enrollmentDueDate,
  } = await loadBillingSetup({ session, cycleId: cycle._id });

  for (const row of data.enrollmentStudents) {
    const student = studentsById.get(String(row.studentId));
    const classroom = classroomsById.get(String(row.classroomId));
    const rowCampusId = classroom?.campusId;
    if (!rowCampusId) throw new ApiError(400, `No se pudo determinar campus para el aula ${row.classroomId}`);
    const normalizedPensions = normalizePensionMonthlyAmounts({ pensionMonthlyAmounts: row.pensionMonthlyAmounts });
    const previousSchoolType = row.previousSchoolType || derivePreviousSchoolType(student?.previousCampus);
    const admissionFee = isOwnCampus(previousSchoolType)
      ? { applies: false, amount: 0, isExempt: true, reason: 'Traslado interno' }
      : normalizeFee(row.admissionFee, { includesApplies: true });
    const enrollmentFee = normalizeFee(row.enrollmentFee);

    const enrollmentStudent = new EnrollmentStudent({
      enrollmentId: enrollment._id,
      studentId: row.studentId,
      classroomId: row.classroomId,
      admissionFee,
      enrollmentFee,
      pensionMonthlyAmounts: normalizedPensions,
      previousSchoolType,
      previousSchoolName: previousSchoolType === 'OTHER' ? (row.previousSchoolName || 'EXTERNO') : undefined,
      notes: row.notes || undefined,
      agreedBy: createdByUserId,
      agreedAt: new Date(),
    });
    await enrollmentStudent.save({ session });
    enrollmentStudentDocs.push(enrollmentStudent);

    if (admissionFee.applies && !admissionFee.isExempt) {
      chargesToCreate.push(buildChargePayload({
        studentId: row.studentId,
        cycleId: cycle._id,
        campusId: rowCampusId,
        conceptId: byCode.get('ADMISSION_FEE'),
        concept: 'ADMISSION',
        amount: admissionFee.amount,
        dueDate: admissionDueDate,
        notes: admissionFee.reason,
      }));
    }

    if (!enrollmentFee.isExempt) {
      chargesToCreate.push(buildChargePayload({
        studentId: row.studentId,
        cycleId: cycle._id,
        campusId: rowCampusId,
        conceptId: byCode.get('ENROLLMENT_FEE'),
        concept: 'ENROLLMENT',
        amount: enrollmentFee.amount,
        dueDate: enrollmentDueDate,
        notes: enrollmentFee.reason,
      }));
    }

    for (const [monthIndex, dueDate] of tuitionDueDatesByMonth.entries()) {
      const amount = normalizedPensions[monthIndex];
      if (amount === undefined || amount < 0) continue;

      chargesToCreate.push(buildChargePayload({
        studentId: row.studentId,
        cycleId: cycle._id,
        campusId: rowCampusId,
        conceptId: byCode.get('TUITION'),
        concept: 'TUITION',
        monthIndex,
        amount,
        dueDate,
      }));
    }
  }

  await ensureNoDuplicateCharges({ session, charges: chargesToCreate, cycleId: cycle._id });

  if (chargesToCreate.length) {
    await Charge.insertMany(chargesToCreate, { session });
  }

  for (const row of enrollmentStudentDocs) {
    row.chargesGeneratedAt = chargesToCreate.some((charge) => String(charge.studentId) === String(row.studentId))
      ? new Date()
      : row.chargesGeneratedAt;
    await row.save({ session });

    await upsertStudentCycleForEnrollment({
      studentId: row.studentId,
      cycleId: cycle._id,
      campusId: classroomsById.get(String(row.classroomId))?.campusId,
      enrollmentId: enrollment._id,
      session,
    });

    await Vacancy.updateOne(
      { studentId: row.studentId, cycleId: cycle._id },
      {
        $setOnInsert: { studentId: row.studentId, cycleId: cycle._id },
        $set: { classroomId: row.classroomId },
      },
      { upsert: true, session }
    );
  }

  enrollment.enrollmentStudents = enrollmentStudentDocs.map((row) => row._id);
  enrollment.studentIds = enrollmentStudentDocs.map((row) => row.studentId);
  await enrollment.save({ session });

  const snapshotData = buildContractSnapshot({
    enrollment,
    enrollmentStudents: enrollmentStudentDocs,
    studentsById,
    classroomsById,
    userId: createdByUserId,
    notes: data.notes,
  });
  await new ContractSnapshot(snapshotData).save({ session });

  return {
    enrollment,
    cycle,
    campus,
    campusIds: allowMultiCampus
      ? campusIdsFromClassrooms.map((id) => id.toString())
      : [campus._id.toString()],
    chargesCount: chargesToCreate.length,
  };
}

export async function createEnrollmentService(data, createdByUserId) {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();
    const { enrollment, campus, chargesCount } = await createConfirmedEnrollmentInSession({
      session,
      data,
      createdByUserId,
    });

    await session.commitTransaction();

    await registerAuditLog({
      entityType: 'ENROLLMENT',
      entityId: enrollment._id.toString(),
      action: 'ENROLLMENT_CONFIRMED',
      performedBy: createdByUserId,
      campusId: campus._id.toString(),
      payloadSnapshot: { students: data.enrollmentStudents.length, hasNotes: Boolean(data.notes), chargesCount },
    });

    return Enrollment.findById(enrollment._id)
      .populate('cycleId')
      .populate('campusId')
      .populate({ path: 'enrollmentStudents', populate: [{ path: 'studentId', populate: { path: 'personId' } }, { path: 'classroomId' }] });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
}

export async function finalizeEnrollmentService(payload, userId) {
  const result = await runInTransaction(async (session) => {
    const activeCycle = await Cycle.findOne({ isActive: true })
      .sort({ year: -1, startDate: -1, _id: -1 })
      .session(session);

    const cycle = payload.activeCycleId
      ? await Cycle.findById(payload.activeCycleId).session(session)
      : activeCycle;

    if (!cycle) throw new ApiError(400, 'No hay ciclo activo disponible para matricular');
    if (payload.activeCycleId && !cycle.isActive) throw new ApiError(409, 'El ciclo enviado ya no está activo');

    const students = Array.isArray(payload.students) ? payload.students : [];
    if (!students.length) throw new ApiError(400, 'Debe enviar al menos un alumno');

    const seenStudentDnis = new Set();
    for (const student of students) {
      const dni = normalizeDni(student?.dni);
      if (!dni) continue;
      if (seenStudentDnis.has(dni)) {
        throw new ApiError(409, `No se permiten alumnos duplicados con DNI ${dni} en la misma matrícula`);
      }
      seenStudentDnis.add(dni);
    }

    const tutors = Array.isArray(payload.tutors) ? payload.tutors : [];
    if (!tutors.length) throw new ApiError(400, 'Debe enviar al menos un tutor');
    if (!tutors.some((tutor) => tutor.includeInContract !== false)) {
      throw new ApiError(400, 'Debe haber al menos un tutor firmante');
    }

    const resolvedStudents = [];
    const studentIdByRef = new Map();

    for (const draftStudent of students) {
      const referenceKey = draftStudent.localId || draftStudent.existingStudentId;
      if (!referenceKey) throw new ApiError(400, 'Cada alumno debe tener referencia local o id existente');

      let studentDoc = null;
      if (draftStudent.mode === 'existing') {
        studentDoc = await Student.findById(draftStudent.existingStudentId)
          .populate('personId')
          .session(session);
        if (!studentDoc) throw new ApiError(404, 'Alumno existente no encontrado');
      } else {
        const person = await resolveOrCreatePersonDraft({
          names: draftStudent.names,
          lastNames: draftStudent.lastNames,
          dni: draftStudent.dni,
          gender: draftStudent.gender,
        }, session);

        const existingStudent = await Student.findOne({ personId: person._id }).session(session);
        if (existingStudent) {
          throw new ApiError(409, `Ya existe un alumno registrado para ${person.names} ${person.lastNames}`);
        }

        const internalCode = await nextStudentCode(session);
        studentDoc = await Student.create([{
          personId: person._id,
          internalCode,
          previousCampus: draftStudent.previousSchoolType === 'OTHER'
            ? (draftStudent.previousSchoolName || 'OTHER')
            : (draftStudent.previousSchoolType || undefined),
          notes: draftStudent.notes || undefined,
        }], { session }).then((rows) => rows[0]);

        studentDoc = await Student.findById(studentDoc._id)
          .populate('personId')
          .session(session);
      }

      const currentStatus = await StudentCycle.findOne({ studentId: studentDoc._id, cycleId: cycle._id })
        .select('status')
        .session(session)
        .lean();
      if (currentStatus?.status === 'ENROLLED') {
        throw new ApiError(409, `El alumno ${studentDoc.personId?.names || studentDoc._id} ya se matriculó en el ciclo activo`);
      }

      if (!draftStudent.classroomId) {
        throw new ApiError(400, 'Todos los alumnos deben tener salón');
      }

      const pensionAmount = toNumber(draftStudent?.amounts?.pensionAmount, 0);
      const pensionMonthlyAmounts = Array.isArray(draftStudent?.amounts?.pensionMonthlyAmounts)
        ? draftStudent.amounts.pensionMonthlyAmounts.map((value) => Number(value ?? 0))
        : Array(10).fill(pensionAmount);
      const admissionFeeAmount = toNumber(draftStudent?.amounts?.admissionFeeAmount, 0);
      const enrollmentFeeAmount = toNumber(draftStudent?.amounts?.enrollmentFeeAmount, 0);
      const previousSchoolType = String(draftStudent?.previousSchoolType || 'OTHER').trim().toUpperCase();
      const previousSchoolName = String(draftStudent?.previousSchoolName || '').trim();

      resolvedStudents.push({
        referenceKey,
        student: studentDoc,
        enrollmentStudent: {
          studentId: studentDoc._id.toString(),
          classroomId: draftStudent.classroomId,
          admissionFee: {
            applies: previousSchoolType === 'OTHER',
            isExempt: false,
            amount: previousSchoolType === 'OTHER' ? admissionFeeAmount : 0,
            reason: '',
          },
          enrollmentFee: {
            isExempt: false,
            amount: enrollmentFeeAmount,
            reason: '',
          },
          pensionMonthlyAmounts,
          previousSchoolType,
          previousSchoolName: previousSchoolType === 'OTHER' ? previousSchoolName : undefined,
          notes: draftStudent.notes || undefined,
        },
      });

      studentIdByRef.set(referenceKey, studentDoc._id);
    }

    for (const tutorDraft of tutors) {
      let person = null;
      if (tutorDraft.existingTutorId && mongoose.Types.ObjectId.isValid(tutorDraft.existingTutorId)) {
        person = await Person.findById(tutorDraft.existingTutorId).session(session);
      }

      if (!person) {
        person = await resolveOrCreatePersonDraft({
          names: tutorDraft.names,
          lastNames: tutorDraft.lastNames,
          dni: tutorDraft.dni,
          phone: tutorDraft.phone,
          gender: 'M',
        }, session);
      }

      const linkedStudentIds = Array.isArray(tutorDraft.linkedStudentIds) ? tutorDraft.linkedStudentIds : [];
      for (const linkedRef of linkedStudentIds) {
        const studentId = studentIdByRef.get(linkedRef);
        if (!studentId) continue;

        const existingTutor = await Tutor.findOne({ studentId, tutorPersonId: person._id }).session(session);
        const relationship = mapTutorRelationship(tutorDraft.relationship);

        if (!existingTutor) {
          await Tutor.create([{
            studentId,
            tutorPersonId: person._id,
            relationship,
            isPrimary: false,
            livesWithStudent: true,
            notes: tutorDraft.isLegalResponsible ? 'Responsable legal' : undefined,
          }], { session });
        } else {
          await Tutor.updateOne(
            { _id: existingTutor._id },
            {
              $set: {
                relationship,
                notes: tutorDraft.isLegalResponsible ? 'Responsable legal' : existingTutor.notes,
              },
            },
            { session }
          );
        }
      }
    }

    const enrollmentData = {
      cycleId: String(cycle._id),
      enrollmentStudents: resolvedStudents.map((row) => row.enrollmentStudent),
      notes: payload?.observations?.general || '',
    };

    const { enrollment, chargesCount } = await createConfirmedEnrollmentInSession({
      session,
      data: enrollmentData,
      createdByUserId: userId,
      allowMultiCampus: true,
    });

    const enrollmentCampusIds = Array.isArray(enrollment?.campusIds) && enrollment.campusIds.length
      ? enrollment.campusIds.map((id) => String(id))
      : enrollment?.campusId
        ? [String(enrollment.campusId)]
        : [];

    return {
      enrollmentId: enrollment._id.toString(),
      cycleId: String(cycle._id),
      campusId: enrollmentCampusIds[0] || null,
      campusIds: enrollmentCampusIds,
      studentIds: resolvedStudents.map((row) => row.student._id.toString()),
      chargesCount,
    };
  });

  await registerAuditLog({
    entityType: 'ENROLLMENT',
    entityId: result.enrollmentId,
    action: 'ENROLLMENT_FINALIZED_V2',
    performedBy: userId,
    campusId: result.campusId,
    payloadSnapshot: {
      cycleId: result.cycleId,
      students: result.studentIds.length,
      chargesCount: result.chargesCount,
    },
  });

  return {
    ok: true,
    enrollmentId: result.enrollmentId,
    studentIds: result.studentIds,
    campusIds: result.campusIds,
    status: 'CONFIRMED',
    chargesCreated: result.chargesCount,
  };
}

export async function getEnrollmentService(id) {

  const enrollment = await Enrollment.findById(id)
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
    const enrollment = await Enrollment.findById(enrollmentId).session(session);
    if (!enrollment) throw new ApiError(404, 'Matrícula no encontrada');
    if (enrollment.status === 'CONFIRMED') throw new ApiError(409, 'La matrícula ya fue confirmada');
    if (enrollment.status !== 'DRAFT') throw new ApiError(409, 'El estado actual de matrícula no permite confirmación');

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
      .select('_id displayName cycleId campusId capacity')
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
    }

    await ensureClassroomCapacityForRows({
      session,
      cycleId,
      enrollmentStudents: allEnrollmentStudents,
      classroomsById,
    });

    for (const row of allEnrollmentStudents) {
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

    const {
      byCode,
      tuitionDueDatesByMonth,
      admissionDueDate,
      enrollmentDueDate,
    } = await loadBillingSetup({ session, cycleId });

    const chargesToCreate = [];
    for (const row of allEnrollmentStudents) {
      const student = studentsById.get(String(row.studentId));

      const admissionCharge = buildAdmissionFeeCharge({
        enrollmentStudent: row,
        student,
        conceptId: byCode.get('ADMISSION_FEE'),
        cycleId,
        campusId,
        dueDate: admissionDueDate,
      });
      if (admissionCharge) chargesToCreate.push(admissionCharge);

      const enrollmentCharge = buildEnrollmentFeeCharge({
        enrollmentStudent: row,
        conceptId: byCode.get('ENROLLMENT_FEE'),
        cycleId,
        campusId,
        dueDate: enrollmentDueDate,
      });
      if (enrollmentCharge) chargesToCreate.push(enrollmentCharge);

      const tuitionCharges = buildTuitionCharges({
        enrollmentStudent: row,
        conceptId: byCode.get('TUITION'),
        cycleId,
        campusId,
        dueDatesByMonth: tuitionDueDatesByMonth,
      });
      chargesToCreate.push(...tuitionCharges);

      row.chargesGeneratedAt = new Date();
      await row.save({ session });
    }

    await ensureNoDuplicateCharges({ session, charges: chargesToCreate, cycleId });

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
          notes: payload.notes || enrollment.notes,
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
      const scopedIds = [...scopeCampusIds].map((id) => new mongoose.Types.ObjectId(id));
      where.$or = [{ campusId: { $in: scopedIds } }, { campusIds: { $in: scopedIds } }];
      if (!scopeCampusIds.size) return { items: [], nextCursor: null };
    }
  }

  if (cycleId) where.cycleId = cycleId;
  if (campus) {
    const campusDoc = await Campus.findOne({ $or: [{ _id: toObjectIdOrNull(campus) || null }, { code: campus }] }).select('_id').lean();
    if (!campusDoc) return { items: [], nextCursor: null };
    const campusIdFilter = campusDoc._id;
    if (where.$or) {
      where.$and = [{ $or: where.$or }, { $or: [{ campusId: campusIdFilter }, { campusIds: campusIdFilter }] }];
      delete where.$or;
    } else {
      where.$or = [{ campusId: campusIdFilter }, { campusIds: campusIdFilter }];
    }
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
    .select('_id studentIds enrollmentStudents cycleId campusId campusIds status createdAt')
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
      .select('studentId cycleId status campusId')
      .lean(),
    ContractSnapshot.find({ $or: [{ enrollmentId: { $in: enrollmentIds } }, { matriculaId: { $in: enrollmentIds } }] })
      .select('enrollmentId matriculaId students discounts notes confirmedAt')
      .lean(),
  ]);

  const campusIds = [...new Set([
    ...selected.flatMap((row) => [
      ...(Array.isArray(row.campusIds) ? row.campusIds.map((id) => String(id)) : []),
      ...(row.campusId ? [String(row.campusId)] : []),
    ]),
    ...studentCycles.map((row) => String(row.campusId || '')).filter(Boolean),
  ])].map((id) => new mongoose.Types.ObjectId(id));

  const campuses = campusIds.length
    ? await Campus.find({ _id: { $in: campusIds } }).select('_id code name').lean()
    : [];

  const studentsMap = new Map(students.map((s) => [String(s._id), s]));
  const cycleMap = new Map(cycles.map((c) => [String(c._id), c]));
  const snapshotMap = new Map(snapshots.map((s) => [String(s.enrollmentId || s.matriculaId), s]));
  const campusMap = new Map(campuses.map((c) => [String(c._id), c]));
  const cycleStatusMap = new Map(studentCycles.map((c) => [`${String(c.studentId)}:${String(c.cycleId)}`, c.status]));
  const cycleCampusMap = new Map(studentCycles.map((c) => [`${String(c.studentId)}:${String(c.cycleId)}`, c.campusId ? String(c.campusId) : null]));
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
      const campusIdValue =
        cycleCampusMap.get(`${String(studentIdItem)}:${String(row.cycleId)}`)
        || (Array.isArray(row.campusIds) && row.campusIds.length ? String(row.campusIds[0]) : null)
        || (row.campusId ? String(row.campusId) : null);
      const campus = campusIdValue ? campusMap.get(String(campusIdValue)) : null;

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
        campus: campus ? {
          id: String(campus._id),
          code: campus.code || null,
          name: campus.name || campus.code || null,
        } : (campusIdValue ? { id: campusIdValue, code: null, name: null } : null),
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
