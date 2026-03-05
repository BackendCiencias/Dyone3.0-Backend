import { ApiError } from '../../../utils/errors.js';
import { byScoreThenId, normalizeSearchTerm } from '../../_shared/search/search.utils.js';
import { searchFamiliesForIntake } from '../../families/services/families.search.service.js';
import { searchUnassignedForIntake } from '../../students/services/unassignedStudents.search.service.js';
import { toIntakeSearchItems } from '../presenters/intakeSearch.presenter.js';

export async function intakeSearch({ q, campusScope = 'ALL', limit = 20 }) {
  const trimmedQ = String(q || '').trim();
  const normalizedQ = normalizeSearchTerm(trimmedQ);
  if (normalizedQ.length < 2) throw new ApiError(400, 'q muy corto');

  const normalizedLimit = Math.max(1, Math.min(50, Number(limit) || 20));

  const [families, students] = await Promise.all([
    searchFamiliesForIntake({ q: trimmedQ, limit: normalizedLimit, campusScope }),
    searchUnassignedForIntake({ q: trimmedQ, limit: normalizedLimit, campusScope }),
  ]);

  const ranked = toIntakeSearchItems({ families, students })
    .map((item) => ({ ...item, score: item.type === 'FAMILY' ? 200 : 100, id: item.type === 'FAMILY' ? item.familyId : item.studentId }))
    .sort(byScoreThenId)
    .slice(0, normalizedLimit)
    .map(({ score, id, ...item }) => item);

  return {
    q: trimmedQ,
    campusScope,
    items: ranked,
  };
}
