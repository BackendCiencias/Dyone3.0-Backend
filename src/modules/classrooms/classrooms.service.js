import { findActiveSchoolYearCycleIds, findClassroomsByFilters } from './repositories/classrooms.repository.js';
import { getCapacityForClassrooms } from '../enrollments/services/enrollmentsCapacity.service.js';
import { levelLabels } from './classrooms.schemas.js';

function buildStatus({ capacity, available }) {
  if (capacity === null || available === null) return 'UNKNOWN';
  if (available <= 0) return 'FULL';
  if (available <= 2) return 'LOW';
  return 'OK';
}

function campusSortCode(value) {
  if (!value) return 'ZZZ';

  if (value.startsWith('CIENCIAS')) return value;
  return value;
}

export async function listClassroomOptions({ level, grade, campus, includeCapacity = true }) {
  const cycleIds = await findActiveSchoolYearCycleIds();
  const classrooms = await findClassroomsByFilters({ level, grade, campus, cycleIds });

  let capacityMap = new Map();
  if (includeCapacity) {
    try {
      capacityMap = await getCapacityForClassrooms(classrooms);
    } catch (_error) {
      capacityMap = new Map();
    }
  }

  const shouldSortByGrade = grade === null || grade === undefined;

  const items = classrooms.map((classroom) => {
    const campusCode = classroom?.campusId?.code || null;

    let capacity = null;
    let occupied = null;
    let available = null;

    if (includeCapacity) {
      try {
        const metrics = capacityMap.get(String(classroom._id));
        if (metrics) {
          capacity = metrics.capacity;
          occupied = metrics.occupied;
          available = metrics.available;
        }
      } catch (_error) {
        capacity = null;
        occupied = null;
        available = null;
      }
    }

    return {
      classroomId: String(classroom._id),
      label: classroom.displayName,
      grade: classroom.grade ?? null,
      section: classroom.section,
      level: levelLabels[level] || level,
      campusCode,
      capacity,
      occupied,
      available,
      status: includeCapacity ? buildStatus({ capacity, available }) : 'UNKNOWN',
    };
  }).sort((a, b) => {
    const campusComparison = campusSortCode(a.campusCode).localeCompare(campusSortCode(b.campusCode));
    if (campusComparison !== 0) return campusComparison;

    if (shouldSortByGrade) {
      const gradeComparison = Number(a.grade || 0) - Number(b.grade || 0);
      if (gradeComparison !== 0) return gradeComparison;
    }

    return String(a.section || '').localeCompare(String(b.section || ''));
  });

  return {
    grade: grade ?? null,
    level: levelLabels[level] || level,
    items,
  };
}
