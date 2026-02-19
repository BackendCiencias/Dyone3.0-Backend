import { Classroom } from '../../../models/classroom.model.js';
import { Cycle } from '../../../models/cycle.model.js';

export async function findActiveSchoolYearCycleIds() {
  const cycles = await Cycle.find({ type: 'SCHOOL_YEAR', isActive: true }).select('_id').lean();
  return cycles.map((cycle) => cycle._id);
}

export async function findClassroomsByLevelAndGradeAcrossCampuses({ level, grade, cycleIds }) {
  const filters = {
    isActive: true,
    level,
    grade: String(grade),
  };

  if (cycleIds?.length) {
    filters.cycleId = { $in: cycleIds };
  }

  return Classroom.find(filters)
    .select('_id displayName level grade section capacity campusId cycleId')
    .populate({ path: 'campusId', select: 'code' })
    .lean();
}
