import mongoose from 'mongoose';
import { BillingConcept } from '../../../models/billingConcept.model.js';

const OWN_CAMPUSES = new Set(['CIENCIAS', 'CIENCIAS_APLICADAS', 'CIMAS']);

function toDecimal128(amount) {
  return mongoose.Types.Decimal128.fromString(Number(amount).toFixed(2));
}

function normalizeCampusCode(value) {
  return String(value || '').trim().toUpperCase();
}

export function isOwnCampus(previousCampus) {
  return OWN_CAMPUSES.has(normalizeCampusCode(previousCampus));
}

export function derivePreviousSchoolType(previousCampus) {
  const normalized = normalizeCampusCode(previousCampus);
  if (OWN_CAMPUSES.has(normalized)) return normalized;
  return 'OTHER';
}

export async function resolveBillingConceptsByCode({ session, requiredCodes = [] }) {
  const concepts = await BillingConcept.find({ code: { $in: requiredCodes } })
    .select('_id code')
    .session(session)
    .lean();

  const byCode = new Map(concepts.map((concept) => [concept.code, concept._id]));
  const missingCodes = requiredCodes.filter((code) => !byCode.has(code));

  return { byCode, missingCodes };
}

export function buildAdmissionFeeCharge({ enrollmentStudent, student, conceptId, cycleId, campusId, dueDate = new Date() }) {
  if (!conceptId) return null;
  if (isOwnCampus(student.previousCampus)) return null;

  const fee = enrollmentStudent?.admissionFee || {};
  if (fee.applies !== true) return null;
  if (fee.isExempt === true) return null;

  const amount = Number(fee.amount || 0);
  if (amount <= 0) return null;

  return {
    studentId: enrollmentStudent.studentId,
    cycleId,
    campusId,
    conceptId,
    concept: 'ADMISSION',
    monthIndex: null,
    description: 'Derecho de ingreso',
    totalAmount: toDecimal128(amount),
    outstandingAmount: toDecimal128(amount),
    status: 'OPEN',
    dueDate,
    notes: fee.reason || undefined,
  };
}

export function buildEnrollmentFeeCharge({ enrollmentStudent, conceptId, cycleId, campusId, dueDate = new Date() }) {
  if (!conceptId) return null;

  const fee = enrollmentStudent?.enrollmentFee || {};
  if (fee.isExempt === true) return null;

  const amount = Number(fee.amount || 0);
  if (amount <= 0) return null;

  return {
    studentId: enrollmentStudent.studentId,
    cycleId,
    campusId,
    conceptId,
    concept: 'ENROLLMENT',
    monthIndex: null,
    description: 'Matrícula',
    totalAmount: toDecimal128(amount),
    outstandingAmount: toDecimal128(amount),
    status: 'OPEN',
    dueDate,
    notes: fee.reason || undefined,
  };
}

export function buildTuitionCharges({ enrollmentStudent, conceptId, cycleId, campusId, dueDatesByMonth = new Map() }) {
  if (!conceptId) return [];

  const monthly = Array.isArray(enrollmentStudent?.pensionMonthlyAmounts)
    ? enrollmentStudent.pensionMonthlyAmounts
    : [];

  const charges = [];
  monthly.forEach((rawAmount, index) => {
    const amount = Number(rawAmount || 0);
    if (amount <= 0) return;

    charges.push({
      studentId: enrollmentStudent.studentId,
      cycleId,
      campusId,
      conceptId,
      concept: 'TUITION',
      monthIndex: index,
      description: `Pensión mes ${index + 1}`,
      totalAmount: toDecimal128(amount),
      outstandingAmount: toDecimal128(amount),
      status: 'OPEN',
      dueDate: dueDatesByMonth.get(index) || null,
    });
  });

  return charges;
}

export function buildContractSnapshot({ enrollment, enrollmentStudents, studentsById, classroomsById, userId, notes, tutors = [] }) {
  return {
    enrollmentId: enrollment._id,
    matriculaId: enrollment._id,
    cycleId: enrollment.cycleId,
    campusId: enrollment.campusId,
    confirmedByUserId: userId,
    confirmedAt: new Date(),
    notes: notes || enrollment.notes || undefined,
    students: enrollmentStudents.map((row) => {
      const student = studentsById.get(String(row.studentId));
      const classroom = classroomsById.get(String(row.classroomId));
      return {
        studentId: row.studentId,
        campusId: classroom?.campusId || null,
        monthlyAmount: (Array.isArray(row.pensionMonthlyAmounts) ? row.pensionMonthlyAmounts.find((amount) => amount >= 0) : 0) ?? 0,
        pensionMonthlyAmounts: row.pensionMonthlyAmounts,
        names: student?.personId?.names || null,
        lastNames: student?.personId?.lastNames || null,
        internalCode: student?.internalCode || null,
        classroom: classroom ? {
          classroomId: classroom._id,
          label: classroom.displayName,
        } : undefined,
        previousCampus: student?.previousCampus || null,
        admissionFee: row.admissionFee,
        enrollmentFee: row.enrollmentFee,
      };
    }),
    tutors,
  };
}
