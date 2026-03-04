import { Student } from '../../models/student.model.js';
import { StudentCycle } from '../../models/studentCycle.model.js';
import { Vacancy } from '../../models/vacancy.model.js';
import { Classroom } from '../../models/classroom.model.js';
import { Campus } from '../../models/campus.model.js';
import { Cycle } from '../../models/cycle.model.js';
import { ApiError } from '../../utils/errors.js';
import { buildAccentInsensitiveRegex, buildSearchScore, escapeRegExp, normalizeSearchTerm, byScoreThenId } from './search.utils.js';

async function resolveActiveCycleId() {
  const activeCycle = await Cycle.findOne({ isActive: true }).sort({ year: -1, startDate: -1 }).select('_id').lean();
  return activeCycle?._id || null;
}

export async function searchUnassignedStudents({ q, limit = 20, campusScope = 'ALL' }) {
  const term = String(q || '').trim();
  const normalizedQ = normalizeSearchTerm(term);
  if (normalizedQ.length < 2) throw new ApiError(400, 'q muy corto');

  const normalizedLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  const regex = buildAccentInsensitiveRegex(term) || new RegExp(escapeRegExp(term), 'i');

  const rows = await Student.find({
    $or: [{ familyId: null }, { familyId: { $exists: false } }],
  })
    .populate({ path: 'personId', select: 'names lastNames dni gender' })
    .select('_id personId internalCode activeStatus familyId')
    .limit(normalizedLimit * 5)
    .lean();

  const filtered = rows.filter((row) => {
    const person = row.personId;
    if (!person) return false;
    const fullName = `${person.lastNames || ''} ${person.names || ''}`.trim();
    return regex.test(row.internalCode || '')
      || regex.test(person.dni || '')
      || regex.test(person.names || '')
      || regex.test(person.lastNames || '')
      || regex.test(fullName);
  });

  const activeCycleId = await resolveActiveCycleId();
  const studentIds = filtered.map((row) => row._id);
  let campusCodeByStudent = new Map();

  if (activeCycleId && studentIds.length) {
    const [studentCycles, vacancies] = await Promise.all([
      StudentCycle.find({ studentId: { $in: studentIds }, cycleId: activeCycleId }).select('studentId campusId').lean(),
      Vacancy.find({ studentId: { $in: studentIds }, cycleId: activeCycleId }).select('studentId classroomId').lean(),
    ]);

    const classroomIds = vacancies.map((row) => row.classroomId).filter(Boolean);
    const classrooms = classroomIds.length
      ? await Classroom.find({ _id: { $in: classroomIds } }).select('_id campusId').lean()
      : [];

    const campusIds = [...new Set([
      ...studentCycles.map((row) => String(row.campusId || '')),
      ...classrooms.map((row) => String(row.campusId || '')),
    ].filter(Boolean))];

    const campuses = campusIds.length
      ? await Campus.find({ _id: { $in: campusIds } }).select('_id code').lean()
      : [];

    const campusById = new Map(campuses.map((row) => [String(row._id), row.code]));
    const classroomCampusById = new Map(classrooms.map((row) => [String(row._id), String(row.campusId)]));

    studentCycles.forEach((row) => {
      const code = campusById.get(String(row.campusId));
      if (code) campusCodeByStudent.set(String(row.studentId), code);
    });

    vacancies.forEach((row) => {
      const key = String(row.studentId);
      if (campusCodeByStudent.has(key)) return;
      const campusId = classroomCampusById.get(String(row.classroomId));
      const code = campusId ? campusById.get(campusId) : null;
      if (code) campusCodeByStudent.set(key, code);
    });
  }

  return filtered
    .map((row) => {
      const campusCode = campusCodeByStudent.get(String(row._id)) || null;
      if (campusScope !== 'ALL' && activeCycleId && campusCode && campusCode !== campusScope) return null;
      if (campusScope !== 'ALL' && activeCycleId && !campusCode) return null;

      return {
        type: 'STUDENT',
        studentId: row._id,
        personId: row.personId?._id || null,
        person: {
          names: row.personId?.names || '',
          lastNames: row.personId?.lastNames || '',
          dni: row.personId?.dni || null,
          gender: row.personId?.gender,
        },
        internalCode: row.internalCode || null,
        familyId: null,
        activeStatus: row.activeStatus || 'ACTIVE',
        campusCode,
        hasVacancy: false,
        classroom: null,
        score: buildSearchScore({
          normalizedQ,
          dni: row.personId?.dni,
          names: row.personId?.names,
          lastNames: row.personId?.lastNames,
          internalCode: row.internalCode,
        }),
        id: row._id,
      };
    })
    .filter(Boolean)
    .sort(byScoreThenId)
    .slice(0, normalizedLimit);
}
