import mongoose from 'mongoose';
import { StudentCycle } from '../../../models/studentCycle.model.js';
import { Vacancy } from '../../../models/vacancy.model.js';
import { Campus } from '../../../models/campus.model.js';
import { Student } from '../../../models/student.model.js';
import { Person } from '../../../models/person.model.js';
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
  const filter = { $or: [{ familyId: null }, { familyId: { $exists: false } }] };
  if (cursor) filter._id = { $gt: new mongoose.Types.ObjectId(cursor) };

  return Student.find(filter)
    .sort({ _id: 1 })
    .limit(limit + 1)
    .populate({ path: 'personId', select: 'names lastNames dni gender' })
    .lean();
}

export async function searchUnassigned({ regex, limit }) {
  const rows = await Student.find({
    $or: [{ familyId: null }, { familyId: { $exists: false } }],
  })
    .populate({ path: 'personId', select: 'names lastNames dni gender' })
    .select('_id personId internalCode activeStatus familyId')
    .limit(limit * 5)
    .lean();

  return rows.filter((row) => {
    const person = row.personId;
    if (!person) return false;
    const fullName = `${person.lastNames || ''} ${person.names || ''}`.trim();
    return regex.test(row.internalCode || '')
      || regex.test(person.dni || '')
      || regex.test(person.names || '')
      || regex.test(person.lastNames || '')
      || regex.test(fullName);
  });
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
  return Student.findByIdAndUpdate(studentId, updates, { new: true }).populate('personId').populate('familyId');
}
