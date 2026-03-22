import mongoose from 'mongoose';
import { StudentCycle } from '../../../models/studentCycle.model.js';
import { Vacancy } from '../../../models/vacancy.model.js';
import { Campus } from '../../../models/campus.model.js';
import { Student } from '../../../models/student.model.js';
import { Person } from '../../../models/person.model.js';
import { Tutor } from '../../../models/tutor.model.js';
import { normalizePersonUpdatePayload } from '../../../utils/personNameFormatter.js';

async function hydrateCampus(campusId) {
  if (!campusId) return null;
  const campus = await Campus.findById(campusId).select('_id code').lean();
  return campus ? { id: String(campus._id), code: campus.code } : { id: String(campusId), code: null };
}

export async function findStudentCampusById(studentId, cycleId = null) {
  const cycleFilter = cycleId ? { cycleId } : {};
  const latestCycle = await StudentCycle.findOne({ studentId, ...cycleFilter })
    .sort({ updatedAt: -1 })
    .select('campusId')
    .lean();

  if (latestCycle?.campusId) return hydrateCampus(latestCycle.campusId);

  const latestVacancy = await Vacancy.findOne({ studentId, ...cycleFilter })
    .populate({ path: 'classroomId', select: 'campusId' })
    .lean();

  return hydrateCampus(latestVacancy?.classroomId?.campusId || null);
}

export async function findUnassignedList({ limit, cursor }) {
  const rows = [];
  let nextCursor = cursor ? new mongoose.Types.ObjectId(cursor) : null;
  const batchSize = Math.max((Number(limit) || 20) * 3, 50);

  while (rows.length < limit + 1) {
    const filter = nextCursor ? { _id: { $gt: nextCursor } } : {};
    const batch = await Student.find(filter)
      .sort({ _id: 1 })
      .limit(batchSize)
      .populate({ path: 'personId', select: 'names lastNames dni gender' })
      .lean();

    if (!batch.length) break;

    const tutorStudentIds = await Tutor.distinct('studentId', { studentId: { $in: batch.map((row) => row._id) } });
    const tutorStudentIdSet = new Set(tutorStudentIds.map((id) => String(id)));
    const rowsWithoutTutors = batch.filter((row) => !tutorStudentIdSet.has(String(row._id)));
    rows.push(...rowsWithoutTutors);

    nextCursor = batch[batch.length - 1]._id;
    if (batch.length < batchSize) break;
  }

  return rows.slice(0, limit + 1);
}

export async function searchUnassigned({ regex, limit }) {
  const rows = await Student.find({})
    .populate({ path: 'personId', select: 'names lastNames dni gender' })
    .select('_id personId internalCode activeStatus')
    .lean();

  const matchingRows = rows.filter((row) => {
    const person = row.personId;
    if (!person) return false;
    const fullName = `${person.lastNames || ''} ${person.names || ''}`.trim();
    return regex.test(row.internalCode || '')
      || regex.test(person.dni || '')
      || regex.test(person.names || '')
      || regex.test(person.lastNames || '')
      || regex.test(fullName);
  });

  if (!matchingRows.length) return [];

  const tutorStudentIds = await Tutor.distinct('studentId', { studentId: { $in: matchingRows.map((row) => row._id) } });
  const tutorStudentIdSet = new Set(tutorStudentIds.map((id) => String(id)));

  return matchingRows
    .filter((row) => !tutorStudentIdSet.has(String(row._id)))
    .slice(0, limit * 5);
}

export async function findStudentWithPersonById(studentId) {
  return Student.findById(studentId).populate('personId');
}

export async function findPersonByDni(dni) {
  return Person.findOne({ dni });
}

export async function updatePersonById(personId, updates) {
  return Person.findByIdAndUpdate(
    personId,
    normalizePersonUpdatePayload(updates),
    { new: true, runValidators: true }
  );
}

export async function updateStudentById(studentId, updates) {
  return Student.findByIdAndUpdate(studentId, updates, { new: true }).populate('personId');
}
