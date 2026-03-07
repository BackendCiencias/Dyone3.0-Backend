import { Classroom } from '../../../models/classroom.model.js';
import { Cycle } from '../../../models/cycle.model.js';

export async function findActiveSchoolYearCycleIds() {
  const cycles = await Cycle.find({ type: 'SCHOOL_YEAR', isActive: true }).select('_id').lean();
  return cycles.map((cycle) => cycle._id);
}

export async function findClassroomsByFilters({ level, grade, campus, cycleIds }) {
  const filters = {
    isActive: true,
    level,
  };

  if (grade !== null && grade !== undefined) {
    filters.grade = String(grade);
  }

  if (cycleIds?.length) {
    filters.cycleId = { $in: cycleIds };
  }

  const classrooms = await Classroom.find(filters)
    .select('_id displayName level grade section capacity campusId cycleId')
    .populate({ path: 'campusId', select: 'code', ...(campus ? { match: { code: campus } } : {}) })
    .lean();

  if (!campus) return classrooms;
  return classrooms.filter((classroom) => classroom.campusId);
}
