import { StudentCycle } from '../../../models/studentCycle.model.js';
import { Vacancy } from '../../../models/vacancy.model.js';
import { Campus } from '../../../models/campus.model.js';

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
    .sort({ startDate: -1 })
    .populate({ path: 'classroomId', select: 'campusId' })
    .lean();

  return hydrateCampus(latestVacancy?.classroomId?.campusId || null);
}
