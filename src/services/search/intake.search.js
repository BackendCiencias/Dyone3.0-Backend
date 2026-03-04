import { ApiError } from '../../utils/errors.js';
import { byScoreThenId, normalizeSearchTerm } from './search.utils.js';
import { searchFamilies } from './families.search.js';
import { searchUnassignedStudents } from './unassignedStudents.search.js';

export async function intakeSearch({ q, campusScope = 'ALL', limit = 20 }) {
  const trimmedQ = String(q || '').trim();
  const normalizedQ = normalizeSearchTerm(trimmedQ);
  if (normalizedQ.length < 2) throw new ApiError(400, 'q muy corto');

  const normalizedLimit = Math.max(1, Math.min(50, Number(limit) || 20));

  const [families, students] = await Promise.all([
    searchFamilies({ q: trimmedQ, limit: normalizedLimit, campusScope }),
    searchUnassignedStudents({ q: trimmedQ, limit: normalizedLimit, campusScope }),
  ]);

  const items = [...families, ...students]
    .sort(byScoreThenId)
    .slice(0, normalizedLimit)
    .map(({ score, id, ...item }) => item);

  return {
    q: trimmedQ,
    campusScope,
    items,
  };
}
