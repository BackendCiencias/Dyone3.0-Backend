import { StudentCycle } from '../../../models/studentCycle.model.js';
import { Vacancy } from '../../../models/vacancy.model.js';
import { Classroom } from '../../../models/classroom.model.js';
import { Campus } from '../../../models/campus.model.js';
import { Cycle } from '../../../models/cycle.model.js';
import { ApiError } from '../../../utils/errors.js';
import { buildAccentInsensitiveRegex, buildSearchScore, byScoreThenId, escapeRegExp, normalizeSearchTerm } from '../../_shared/search/search.utils.js';
import { searchUnassigned as repoSearchUnassigned } from '../repositories/students.repository.js';
import { toUnassignedStudentListItem } from '../presenters/unassignedStudentListItem.presenter.js';

async function resolveActiveCycleId() {
  const activeCycle = await Cycle.findOne({ isActive: true }).sort({ year: -1, startDate: -1 }).select('_id').lean();
  return activeCycle?._id || null;
}

async function resolveCampusCodeByStudent(studentIds = []) {
  const activeCycleId = await resolveActiveCycleId();
  if (!activeCycleId || !studentIds.length) return new Map();

  const [studentCycles, vacancies] = await Promise.all([
    StudentCycle.find({ studentId: { $in: studentIds }, cycleId: activeCycleId }).select('studentId campusId').lean(),
    Vacancy.find({ studentId: { $in: studentIds }, cycleId: activeCycleId }).select('studentId classroomId').lean(),
  ]);

  const classrooms = await Classroom.find({ _id: { $in: vacancies.map((row) => row.classroomId).filter(Boolean) } }).select('_id campusId').lean();
  const campusIds = [...new Set([
    ...studentCycles.map((row) => String(row.campusId || '')),
    ...classrooms.map((row) => String(row.campusId || '')),
  ].filter(Boolean))];
  const campuses = campusIds.length ? await Campus.find({ _id: { $in: campusIds } }).select('_id code').lean() : [];

  const campusById = new Map(campuses.map((row) => [String(row._id), row.code]));
  const classroomCampusById = new Map(classrooms.map((row) => [String(row._id), String(row.campusId)]));

  const studentCycleCampus = new Map(studentCycles.map((row) => [String(row.studentId), campusById.get(String(row.campusId)) || null]));
  const vacancyCampus = new Map();
  vacancies.forEach((row) => {
    const campusId = classroomCampusById.get(String(row.classroomId));
    vacancyCampus.set(String(row.studentId), campusId ? campusById.get(campusId) || null : null);
  });

  const result = new Map();
  studentIds.forEach((id) => {
    const key = String(id);
    result.set(key, vacancyCampus.get(key) ?? studentCycleCampus.get(key) ?? null);
  });

  return result;
}

export async function searchUnassignedStudentsService({ q, limit = 20, campusScope = 'ALL' }) {
  const term = String(q || '').trim();
  const normalizedQ = normalizeSearchTerm(term);
  if (normalizedQ.length < 2) throw new ApiError(400, 'q muy corto');

  const normalizedLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  const regex = buildAccentInsensitiveRegex(term) || new RegExp(escapeRegExp(term), 'i');

  const rows = await repoSearchUnassigned({ regex, limit: normalizedLimit });
  const campusCodeByStudent = await resolveCampusCodeByStudent(rows.map((row) => row._id));

  return rows
    .map((row) => {
      const campusCode = campusCodeByStudent.get(String(row._id)) ?? null;
      if (campusScope !== 'ALL' && campusCode && campusCode !== campusScope) return null;
      if (campusScope !== 'ALL' && !campusCode) return null;

      return {
        ...row,
        campusCode,
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
    .slice(0, normalizedLimit)
    .map((row) => toUnassignedStudentListItem(row));
}

export async function searchUnassignedForIntake(params) {
  return searchUnassignedStudentsService(params);
}

export async function addCampusToStudents(rows = []) {
  const campusCodeByStudent = await resolveCampusCodeByStudent(rows.map((row) => row._id));
  return rows.map((row) => ({ ...row, campusCode: campusCodeByStudent.get(String(row._id)) ?? null }));
}
