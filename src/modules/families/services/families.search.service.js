import { Person } from '../../../models/person.model.js';
import { Student } from '../../../models/student.model.js';
import { Tutor } from '../../../models/tutor.model.js';
import { StudentCycle } from '../../../models/studentCycle.model.js';
import { Vacancy } from '../../../models/vacancy.model.js';
import { Classroom } from '../../../models/classroom.model.js';
import { Campus } from '../../../models/campus.model.js';
import { Cycle } from '../../../models/cycle.model.js';
import { ApiError } from '../../../utils/errors.js';
import { buildAccentInsensitiveRegex, buildSearchScore, byScoreThenId, normalizeSearchTerm } from '../../_shared/search/search.utils.js';
import { searchFamilies as findFamiliesForSearch } from '../repositories/families.repository.js';
import { toFamilyListItem } from '../presenters/familyListItem.presenter.js';

async function resolveActiveCycleId() {
  const activeCycle = await Cycle.findOne({ isActive: true }).sort({ year: -1, startDate: -1 }).select('_id').lean();
  return activeCycle?._id || null;
}

async function attachCampus(students = []) {
  const activeCycleId = await resolveActiveCycleId();
  const ids = students.map((s) => s._id);
  if (!activeCycleId || !ids.length) return students.map((s) => ({ ...s, currentCampusCode: null }));

  const [studentCycles, vacancies] = await Promise.all([
    StudentCycle.find({ studentId: { $in: ids }, cycleId: activeCycleId }).select('studentId campusId').lean(),
    Vacancy.find({ studentId: { $in: ids }, cycleId: activeCycleId }).select('studentId classroomId').lean(),
  ]);

  const classrooms = await Classroom.find({ _id: { $in: vacancies.map((v) => v.classroomId).filter(Boolean) } }).select('_id campusId').lean();
  const campusIds = [...new Set([
    ...studentCycles.map((x) => String(x.campusId || '')),
    ...classrooms.map((x) => String(x.campusId || '')),
  ].filter(Boolean))];
  const campuses = campusIds.length ? await Campus.find({ _id: { $in: campusIds } }).select('_id code').lean() : [];

  const campusById = new Map(campuses.map((c) => [String(c._id), c.code]));
  const classroomCampusById = new Map(classrooms.map((c) => [String(c._id), String(c.campusId)]));
  const studentCycleCampus = new Map(studentCycles.map((row) => [String(row.studentId), campusById.get(String(row.campusId)) || null]));
  const vacancyCampus = new Map();
  vacancies.forEach((row) => {
    const campusId = classroomCampusById.get(String(row.classroomId));
    vacancyCampus.set(String(row.studentId), campusId ? campusById.get(campusId) || null : null);
  });

  return students.map((student) => ({
    ...student,
    currentCampusCode: vacancyCampus.get(String(student._id)) ?? studentCycleCampus.get(String(student._id)) ?? null,
  }));
}

export async function searchFamiliesService({ q, limit = 20, campusScope = 'ALL' }) {
  const term = String(q || '').trim();
  const normalizedQ = normalizeSearchTerm(term);
  if (normalizedQ.length < 2) throw new ApiError(400, 'q muy corto');

  const normalizedLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  const queryRegex = buildAccentInsensitiveRegex(term);
  if (!queryRegex) return [];

  const personIds = (await Person.find({ $or: [{ names: queryRegex }, { lastNames: queryRegex }, { dni: queryRegex }] }).select('_id').lean()).map((person) => person._id);
  const personIdFilter = personIds.length ? { $in: personIds } : null;

  const [primaryTutorTutorIds, tutorIds, matchedStudentsByPerson, matchedStudentsByCode] = await Promise.all([
    personIdFilter ? Tutor.find({ tutorPersonId: personIdFilter, isPrimary: true }).select('_id').lean() : Promise.resolve([]),
    personIdFilter ? Tutor.find({ tutorPersonId: personIdFilter }).select('_id').lean() : Promise.resolve([]),
    personIdFilter ? Student.find({ personId: personIdFilter }).select('_id').lean() : Promise.resolve([]),
    Student.find({ $or: [{ internalCode: queryRegex }, { bankCode: queryRegex }] }).select('_id').lean(),
  ]);

  const primaryTutorFamilyIds = primaryTutorTutorIds.length
    ? (await findFamiliesForSearch({ campus: null })).filter((f) => f.tutorIds?.some((t) => primaryTutorTutorIds.some((id) => String(id._id) === String(t._id)))).map((f) => String(f._id))
    : [];
  const tutorFamilyIds = tutorIds.length
    ? (await findFamiliesForSearch({ campus: null })).filter((f) => f.tutorIds?.some((t) => tutorIds.some((id) => String(id._id) === String(t._id)))).map((f) => String(f._id))
    : [];

  const studentIds = [...matchedStudentsByPerson, ...matchedStudentsByCode].map((row) => String(row._id));
  const allFamilies = await findFamiliesForSearch({ campus: campusScope === 'ALL' ? null : campusScope });
  const orderedFamilyIds = [];
  const seen = new Set();

  [primaryTutorFamilyIds, tutorFamilyIds].forEach((group) => {
    group.forEach((familyId) => {
      if (seen.has(familyId)) return;
      seen.add(familyId);
      orderedFamilyIds.push(familyId);
    });
  });

  allFamilies.forEach((family) => {
    if (orderedFamilyIds.includes(String(family._id))) return;
    const matched = (family.studentIds || []).some((student) => studentIds.includes(String(student._id)));
    if (matched) orderedFamilyIds.push(String(family._id));
  });

  const familyOrder = new Map(orderedFamilyIds.map((id, index) => [id, index]));

  const normalized = [];
  for (const family of allFamilies) {
    if (!familyOrder.has(String(family._id))) continue;
    const enrichedStudents = await attachCampus(family.studentIds || []);
    const primaryTutor = (family.tutorIds || []).find((t) => t.isPrimary) || family.tutorIds?.[0] || null;
    normalized.push({
      ...family,
      studentIds: enrichedStudents,
      score: buildSearchScore({
        normalizedQ,
        dni: primaryTutor?.tutorPersonId?.dni || enrichedStudents[0]?.personId?.dni,
        names: primaryTutor?.tutorPersonId?.names || enrichedStudents[0]?.personId?.names,
        lastNames: primaryTutor?.tutorPersonId?.lastNames || enrichedStudents[0]?.personId?.lastNames,
        internalCode: null,
      }),
      id: family._id,
    });
  }

  return normalized.sort((a, b) => {
    const orderA = familyOrder.get(String(a._id));
    const orderB = familyOrder.get(String(b._id));
    if (orderA !== orderB) return orderA - orderB;
    return byScoreThenId(a, b);
  }).slice(0, normalizedLimit).map((row) => toFamilyListItem(row));
}

export async function searchFamiliesForIntake(params) {
  return searchFamiliesService(params);
}
