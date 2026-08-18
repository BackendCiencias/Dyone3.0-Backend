import { findActiveSchoolYearCycleIds, findClassroomsByFilters } from './repositories/classrooms.repository.js';
import { getCapacityForClassrooms } from '../enrollments/services/enrollmentsCapacity.service.js';
import { levelLabels } from './classrooms.schemas.js';
import { Campus } from '../../models/campus.model.js';
import { Enrollment } from '../../models/enrollment.model.js';
import { EnrollmentStudent } from '../../models/enrollmentStudent.model.js';
import { Student } from '../../models/student.model.js';

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

export function buildClassroomBoardEnrollmentFilter(cycleId) {
  return cycleId ? { cycleId, status: { $ne: 'TRANSFERRED' } } : null;
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
      level: levelLabels[classroom.level] || classroom.level,
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
    level: level ? (levelLabels[level] || level) : null,
    items,
  };
}

export async function getClassroomBoardService({ campus, level, grade }) {
  const cycleIds = await findActiveSchoolYearCycleIds();
  const classrooms = await findClassroomsByFilters({ level, grade, campus, cycleIds });
  const validClassrooms = classrooms.filter((row) => row?.campusId?.code === campus);

  const campusRow = await Campus.findOne({ code: campus }).select('_id code name').lean();
  const classroomIds = validClassrooms.map((row) => row._id);
  const cycleId = validClassrooms[0]?.cycleId || cycleIds[0] || null;
  // An enrollment can contain students from different campuses after a family
  // merge. The student's classroom, not the enrollment header, is the source
  // of truth for the classroom board campus.
  const enrollmentFilter = buildClassroomBoardEnrollmentFilter(cycleId);
  const enrollments = enrollmentFilter
    ? await Enrollment.find(enrollmentFilter).select('_id status').lean()
    : [];

  const enrollmentMap = new Map(enrollments.map((row) => [String(row._id), row]));
  const enrollmentStudents = enrollments.length
    ? await EnrollmentStudent.find({
      enrollmentId: { $in: enrollments.map((row) => row._id) },
      classroomId: { $in: classroomIds },
    }).select('_id enrollmentId studentId classroomId').lean()
    : [];

  const studentIds = [...new Set(enrollmentStudents.map((row) => String(row.studentId)).filter(Boolean))];
  const students = studentIds.length
    ? await Student.find({ _id: { $in: studentIds } })
      .populate({ path: 'personId', select: 'names lastNames dni' })
      .select('_id internalCode activeStatus personId')
      .lean()
    : [];
  const studentMap = new Map(students.map((row) => [String(row._id), row]));

  const studentsByClassroomId = new Map();
  for (const row of enrollmentStudents) {
    const classroomId = String(row.classroomId || '');
    const student = studentMap.get(String(row.studentId));
    const enrollment = enrollmentMap.get(String(row.enrollmentId));
    if (!student || !classroomId) continue;
    if (!studentsByClassroomId.has(classroomId)) studentsByClassroomId.set(classroomId, []);

    studentsByClassroomId.get(classroomId).push({
      enrollmentId: String(row.enrollmentId),
      enrollmentStudentId: String(row._id),
      studentId: String(student._id),
      internalCode: student.internalCode || null,
      activeStatus: student.activeStatus || null,
      names: student.personId?.names || null,
      lastNames: student.personId?.lastNames || null,
      dni: student.personId?.dni || null,
      enrollmentStatus: enrollment?.status || null,
    });
  }

  const columns = validClassrooms
    .map((classroom) => {
      const classroomId = String(classroom._id);
      const items = (studentsByClassroomId.get(classroomId) || [])
        .sort((a, b) => {
          const aLast = String(a.lastNames || '');
          const bLast = String(b.lastNames || '');
          if (aLast !== bLast) return aLast.localeCompare(bLast, 'es');
          const aName = String(a.names || '');
          const bName = String(b.names || '');
          if (aName !== bName) return aName.localeCompare(bName, 'es');
          return String(a.studentId).localeCompare(String(b.studentId));
        });

      return {
        classroomId,
        label: classroom.displayName,
        section: classroom.section || null,
        grade: classroom.grade || null,
        level: levelLabels[classroom.level] || classroom.level,
        students: items,
        studentsCount: items.length,
      };
    })
    .sort((a, b) => String(a.section || '').localeCompare(String(b.section || ''), 'es'));

  return {
    campus: campusRow ? { id: String(campusRow._id), code: campusRow.code, name: campusRow.name } : { code: campus, name: null },
    cycleId: cycleId ? String(cycleId) : null,
    level: levelLabels[level] || level,
    grade,
    columns,
    totals: {
      classrooms: columns.length,
      students: columns.reduce((acc, column) => acc + column.studentsCount, 0),
    },
  };
}
