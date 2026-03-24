import mongoose from 'mongoose';
import { Enrollment } from '../models/enrollment.model.js';
import { EnrollmentStudent } from '../models/enrollmentStudent.model.js';
import { Classroom } from '../models/classroom.model.js';
import { Campus } from '../models/campus.model.js';
import { Cycle } from '../models/cycle.model.js';
import { ApiError } from '../utils/errors.js';

function toObjectId(value) {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : null;
}

function getEnrollmentStatusPriority(status) {
  const normalized = String(status || '').trim().toUpperCase();
  if (normalized === 'ENROLLED') return 4;
  if (normalized === 'TRANSFERRED') return 3;
  if (normalized === 'ABSENT') return 2;
  return 1;
}

export async function getEnrollmentContextMapByStudentIds(studentIds = [], { cycleId = null, session = null } = {}) {
  const uniqueStudentIds = [...new Set(studentIds.map((id) => String(id)).filter(Boolean))];
  if (!uniqueStudentIds.length) return new Map();

  const enrollmentStudentQuery = EnrollmentStudent.find({
    studentId: { $in: uniqueStudentIds.map((id) => new mongoose.Types.ObjectId(id)) },
  })
    .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
    .lean();
  if (session) enrollmentStudentQuery.session(session);
  const enrollmentStudents = await enrollmentStudentQuery;

  const enrollmentIds = [...new Set(enrollmentStudents.map((row) => String(row.enrollmentId)).filter(Boolean))]
    .map((id) => new mongoose.Types.ObjectId(id));
  if (!enrollmentIds.length) return new Map();

  const enrollmentFilter = { _id: { $in: enrollmentIds } };
  const normalizedCycleId = toObjectId(cycleId);
  if (normalizedCycleId) enrollmentFilter.cycleId = normalizedCycleId;

  const enrollmentQuery = Enrollment.find(enrollmentFilter)
    .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
    .lean();
  if (session) enrollmentQuery.session(session);
  const enrollments = await enrollmentQuery;

  const enrollmentById = new Map(enrollments.map((row) => [String(row._id), row]));
  const selectedByStudentId = new Map();

  for (const row of enrollmentStudents) {
    const enrollment = enrollmentById.get(String(row.enrollmentId));
    if (!enrollment) continue;

    const key = String(row.studentId);
    const current = selectedByStudentId.get(key);
    if (!current) {
      selectedByStudentId.set(key, { enrollment, enrollmentStudent: row });
      continue;
    }

    const currentPriority = getEnrollmentStatusPriority(current.enrollment?.status);
    const nextPriority = getEnrollmentStatusPriority(enrollment?.status);
    if (nextPriority > currentPriority) {
      selectedByStudentId.set(key, { enrollment, enrollmentStudent: row });
    }
  }

  const classroomIds = [...new Set(
    Array.from(selectedByStudentId.values())
      .map((row) => String(row.enrollmentStudent.classroomId || ''))
      .filter(Boolean),
  )].map((id) => new mongoose.Types.ObjectId(id));

  const campusIds = [...new Set(
    Array.from(selectedByStudentId.values())
      .flatMap((row) => [String(row.enrollment.campusId || ''), String(row.enrollmentStudent.classroomId || '')])
      .filter(Boolean),
  )];

  const classroomQuery = classroomIds.length
    ? Classroom.find({ _id: { $in: classroomIds } }).select('_id campusId cycleId level grade section displayName').lean()
    : Promise.resolve([]);
  const cycleQuery = Cycle.find({
    _id: {
      $in: [...new Set(Array.from(selectedByStudentId.values()).map((row) => String(row.enrollment.cycleId)).filter(Boolean))]
        .map((id) => new mongoose.Types.ObjectId(id)),
    },
  }).select('_id name year type').lean();

  const [classrooms, cycles] = await Promise.all([classroomQuery, cycleQuery]);
  const classroomById = new Map(classrooms.map((row) => [String(row._id), row]));

  const effectiveCampusIds = [...new Set(
    Array.from(selectedByStudentId.values())
      .map((row) => {
        const classroom = classroomById.get(String(row.enrollmentStudent.classroomId || ''));
        return String(classroom?.campusId || row.enrollment.campusId || '');
      })
      .filter(Boolean),
  )].map((id) => new mongoose.Types.ObjectId(id));

  const campusQuery = effectiveCampusIds.length
    ? Campus.find({ _id: { $in: effectiveCampusIds } }).select('_id code name').lean()
    : Promise.resolve([]);
  const campuses = await campusQuery;

  const cycleById = new Map(cycles.map((row) => [String(row._id), row]));
  const campusById = new Map(campuses.map((row) => [String(row._id), row]));

  const result = new Map();
  for (const [studentId, selected] of selectedByStudentId.entries()) {
    const classroom = classroomById.get(String(selected.enrollmentStudent.classroomId || '')) || null;
    const campus = campusById.get(String(classroom?.campusId || selected.enrollment.campusId || '')) || null;
    const cycle = cycleById.get(String(selected.enrollment.cycleId || '')) || null;

    result.set(studentId, {
      enrollment: selected.enrollment,
      enrollmentStudent: selected.enrollmentStudent,
      classroom,
      campus,
      cycle,
    });
  }

  return result;
}

export async function getEnrollmentContextForStudent(studentId, options = {}) {
  const map = await getEnrollmentContextMapByStudentIds([studentId], options);
  return map.get(String(studentId)) || null;
}

export async function updateEnrollmentStatusForStudent({
  studentId,
  cycleId,
  status,
  reason,
  userId = null,
  session = null,
}) {
  const context = await getEnrollmentContextForStudent(studentId, { cycleId, session });
  if (!context?.enrollment) {
    throw new ApiError(404, 'No se encontró matrícula para el alumno en el ciclo solicitado');
  }

  const notes = String(reason || '').trim();
  const currentNotes = String(context.enrollment.notes || '').trim();
  const nextNotes = notes
    ? `${currentNotes ? `${currentNotes}\n` : ''}[${new Date().toISOString()}] ${notes}`
    : currentNotes || undefined;

  const update = {
    status,
    notes: nextNotes,
    updatedBy: userId || context.enrollment.updatedBy || undefined,
  };

  if (status === 'ENROLLED' && !context.enrollment.confirmedAt) {
    update.confirmedAt = new Date();
  }
  if (status === 'TRANSFERRED') {
    update.transferredAt = new Date();
  }
  if (status !== 'TRANSFERRED') {
    update.transferredAt = null;
  }

  const query = Enrollment.findByIdAndUpdate(
    context.enrollment._id,
    { $set: update },
    { new: true, lean: true },
  );
  if (session) query.session(session);
  return query;
}
