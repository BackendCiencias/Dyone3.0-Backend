export function toIntakeSearchItems({ families = [], students = [] }) {
  const familyItems = families.map((family) => ({
    type: 'FAMILY',
    familyId: family.familyId,
    primaryTutor: family.primaryTutor
      ? {
        personId: null,
        names: family.primaryTutor.names || '',
        lastNames: family.primaryTutor.lastNames || '',
        dni: family.primaryTutor.dni || null,
        phone: family.primaryTutor.phone || null,
      }
      : null,
    address: family.address || null,
    studentsCount: family.studentsCount || 0,
    students: Array.isArray(family.students) ? family.students : [],
    campusHints: [...new Set((family.students || []).map((student) => student.currentCampusCode).filter(Boolean))],
  }));

  const studentItems = students.map((student) => ({
    type: 'STUDENT',
    studentId: student._id,
    person: {
      names: student.personId?.names || '',
      lastNames: student.personId?.lastNames || '',
      dni: student.personId?.dni || null,
      gender: student.personId?.gender || 'M',
    },
    familyId: null,
    activeStatus: student.activeStatus,
    campusCode: student.campusCode ?? null,
    cycleStatus: null,
    hasVacancy: false,
    classroom: null,
  }));

  return [...familyItems, ...studentItems];
}
