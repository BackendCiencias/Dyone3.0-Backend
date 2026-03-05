export function toUnassignedStudentListItem(student = {}) {
  const person = student.personId || student.person || null;

  return {
    _id: String(student._id || student.studentId),
    internalCode: student.internalCode || null,
    personId: person
      ? {
        _id: String(person._id || person.personId || ''),
        names: person.names || '',
        lastNames: person.lastNames || '',
        dni: person.dni ?? null,
        gender: person.gender,
      }
      : null,
    activeStatus: student.activeStatus || 'ACTIVE',
    campusCode: student.campusCode ?? null,
  };
}
