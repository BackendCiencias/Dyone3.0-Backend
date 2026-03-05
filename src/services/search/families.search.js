import { Family } from '../../models/family.model.js';
import { Person } from '../../models/person.model.js';
import { Student } from '../../models/student.model.js';
import { Tutor } from '../../models/tutor.model.js';
import { StudentCycle } from '../../models/studentCycle.model.js';
import { Vacancy } from '../../models/vacancy.model.js';
import { Classroom } from '../../models/classroom.model.js';
import { Campus } from '../../models/campus.model.js';
import { Cycle } from '../../models/cycle.model.js';
import { ApiError } from '../../utils/errors.js';
import { buildAccentInsensitiveRegex, buildSearchScore, normalizeSearchTerm, byScoreThenId } from './search.utils.js';

async function resolveActiveCycleId() {
  const activeCycle = await Cycle.findOne({ isActive: true }).sort({ year: -1, startDate: -1 }).select('_id').lean();
  return activeCycle?._id || null;
}

export async function searchFamilies({ q, limit = 20, campusScope = 'ALL' }) {
  const term = String(q || '').trim();
  const normalizedQ = normalizeSearchTerm(term);
  if (normalizedQ.length < 2) throw new ApiError(400, 'q muy corto');

  const normalizedLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  const queryRegex = buildAccentInsensitiveRegex(term);
  if (!queryRegex) return [];

  const personIds = (await Person.find({
    $or: [{ names: queryRegex }, { lastNames: queryRegex }, { dni: queryRegex }],
  }).select('_id').lean()).map((person) => person._id);

  const personIdFilter = personIds.length ? { $in: personIds } : null;

  const [primaryTutorTutorIds, tutorIds, matchedStudentsByPerson, matchedStudentsByCode] = await Promise.all([
    personIdFilter
      ? Tutor.find({ tutorPersonId: personIdFilter, isPrimary: true }).select('_id').lean()
      : Promise.resolve([]),
    personIdFilter
      ? Tutor.find({ tutorPersonId: personIdFilter }).select('_id').lean()
      : Promise.resolve([]),
    personIdFilter
      ? Student.find({ personId: personIdFilter }).select('_id').lean()
      : Promise.resolve([]),
    Student.find({ $or: [{ internalCode: queryRegex }, { bankCode: queryRegex }] }).select('_id').lean(),
  ]);

  const primaryTutorFamilyIds = primaryTutorTutorIds.length
    ? (await Family.find({ tutorIds: { $in: primaryTutorTutorIds.map((tutor) => tutor._id) } }).select('_id').lean())
      .map((family) => String(family._id))
    : [];

  const tutorFamilyIds = tutorIds.length
    ? (await Family.find({ tutorIds: { $in: tutorIds.map((tutor) => tutor._id) } }).select('_id').lean())
      .map((family) => String(family._id))
    : [];

  const studentIds = [...matchedStudentsByPerson, ...matchedStudentsByCode].map((row) => row._id);
  const studentFamilyIds = studentIds.length
    ? (await Family.find({ studentIds: { $in: studentIds } }).select('_id').lean())
      .map((family) => String(family._id))
    : [];

  const orderedFamilyIds = [];
  const seen = new Set();
  [primaryTutorFamilyIds, tutorFamilyIds, studentFamilyIds].forEach((group) => {
    group.forEach((familyId) => {
      if (seen.has(familyId)) return;
      seen.add(familyId);
      orderedFamilyIds.push(familyId);
    });
  });

  if (!orderedFamilyIds.length) return [];

  const families = await Family.find({ _id: { $in: orderedFamilyIds } })
    .populate({ path: 'studentIds', populate: { path: 'personId', select: 'names lastNames dni gender' } })
    .populate({ path: 'tutorIds', populate: { path: 'tutorPersonId', select: 'names lastNames dni phone' } })
    .lean();

  const familyOrder = new Map(orderedFamilyIds.map((id, index) => [id, index]));
  families.sort((a, b) => familyOrder.get(String(a._id)) - familyOrder.get(String(b._id)));

  const activeCycleId = await resolveActiveCycleId();
  const familyStudentIds = families.flatMap((family) => family.studentIds || []).map((student) => student._id);
  let campusHintsByStudent = new Map();

  if (activeCycleId && familyStudentIds.length) {
    const [studentCycles, vacancies] = await Promise.all([
      StudentCycle.find({ studentId: { $in: familyStudentIds }, cycleId: activeCycleId }).select('studentId campusId').lean(),
      Vacancy.find({ studentId: { $in: familyStudentIds }, cycleId: activeCycleId }).select('studentId classroomId').lean(),
    ]);

    const classroomIds = vacancies.map((row) => row.classroomId).filter(Boolean);
    const classrooms = classroomIds.length ? await Classroom.find({ _id: { $in: classroomIds } }).select('_id campusId').lean() : [];
    const campusIds = [...new Set([
      ...studentCycles.map((row) => String(row.campusId || '')),
      ...classrooms.map((row) => String(row.campusId || '')),
    ].filter(Boolean))];
    const campuses = campusIds.length ? await Campus.find({ _id: { $in: campusIds } }).select('_id code').lean() : [];

    const campusById = new Map(campuses.map((row) => [String(row._id), row.code]));
    const classroomCampusById = new Map(classrooms.map((row) => [String(row._id), String(row.campusId)]));

    studentCycles.forEach((row) => {
      const key = String(row.studentId);
      const code = campusById.get(String(row.campusId));
      if (!code) return;
      if (!campusHintsByStudent.has(key)) campusHintsByStudent.set(key, new Set());
      campusHintsByStudent.get(key).add(code);
    });

    vacancies.forEach((row) => {
      const key = String(row.studentId);
      const campusId = classroomCampusById.get(String(row.classroomId));
      const code = campusId ? campusById.get(campusId) : null;
      if (!code) return;
      if (!campusHintsByStudent.has(key)) campusHintsByStudent.set(key, new Set());
      campusHintsByStudent.get(key).add(code);
    });
  }
  const items = families
    .map((family) => {
      const students = family.studentIds || [];
      // console.log("[DBG] [students]: ",students)
      const studentsCount = students.length;
      const tutors = family.tutorIds || [];
      const primaryTutor = tutors.find((tutor) => tutor.isPrimary) || tutors[0] || null;
      const firstStudent = students[0]?.personId || null;
      const campusHints = [...new Set(students.flatMap((student) => [...(campusHintsByStudent.get(String(student._id)) || [])]))];

      if (campusScope !== 'ALL' && campusHints.length && !campusHints.includes(campusScope)) return null;
      if (campusScope !== 'ALL' && !campusHints.length && activeCycleId) return null;

      return {
        type: 'FAMILY',
        familyId: family._id,
        primaryTutor: primaryTutor ? {
          personId: primaryTutor.tutorPersonId?._id || null,
          names: primaryTutor.tutorPersonId?.names || null,
          lastNames: primaryTutor.tutorPersonId?.lastNames || null,
          dni: primaryTutor.tutorPersonId?.dni || null,
          phone: primaryTutor.tutorPersonId?.phone || null,
        } : null,
        studentsCount,
        students: students || [],
        campusHints,
        score: buildSearchScore({
          normalizedQ,
          dni: primaryTutor?.tutorPersonId?.dni || firstStudent?.dni,
          names: primaryTutor?.tutorPersonId?.names || firstStudent?.names,
          lastNames: primaryTutor?.tutorPersonId?.lastNames || firstStudent?.lastNames,
          internalCode: null,
        }),
        id: family._id,
      };
    })
    .filter(Boolean)
    .sort(byScoreThenId)
    .slice(0, normalizedLimit);

  // console.log("[DBG] [items]: ",items)

  return items
}
