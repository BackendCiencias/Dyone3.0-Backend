import { Cycle } from '../../../models/cycle.model.js';
import { ApiError } from '../../../utils/errors.js';
import { buildAccentInsensitiveRegex, buildSearchScore, byScoreThenId, escapeRegExp, normalizeSearchTerm } from '../../_shared/search/search.utils.js';
import { searchUnassigned as repoSearchUnassigned } from '../repositories/students.repository.js';
import { toUnassignedStudentListItem } from '../presenters/unassignedStudentListItem.presenter.js';
import { getEnrollmentContextMapByStudentIds } from '../../../shared/enrollmentCurrent.js';

async function resolveActiveCycleId() {
  const activeCycle = await Cycle.findOne({ isActive: true }).sort({ year: -1, startDate: -1 }).select('_id').lean();
  return activeCycle?._id || null;
}

async function resolveCampusCodeByStudent(studentIds = []) {
  const activeCycleId = await resolveActiveCycleId();
  if (!activeCycleId || !studentIds.length) return new Map();
  const enrollmentContexts = await getEnrollmentContextMapByStudentIds(studentIds, { cycleId: activeCycleId });

  const result = new Map();
  studentIds.forEach((id) => {
    const key = String(id);
    result.set(key, enrollmentContexts.get(key)?.campus?.code ?? null);
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
