import { StudentCycle } from '../../../models/studentCycle.model.js';
import { Vacancy } from '../../../models/vacancy.model.js';
import { Campus } from '../../../models/campus.model.js';
import { Student } from '../../../models/student.model.js';
import { Person } from '../../../models/person.model.js';

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

export async function findStudentWithPersonById(studentId) {
  return Student.findById(studentId).populate('personId');
}

export async function findPersonByDni(dni) {
  return Person.findOne({ dni });
}

export async function updatePersonById(personId, updates) {
  return Person.findByIdAndUpdate(personId, updates, { new: true });
}

export async function updateStudentById(studentId, updates) {
  return Student.findByIdAndUpdate(studentId, updates, { new: true }).populate('personId').populate('familyId');
}
