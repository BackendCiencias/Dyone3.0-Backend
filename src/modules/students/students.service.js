import { Person } from '../../models/person.model.js';
import { Student } from '../../models/student.model.js';
import { Family } from '../../models/family.model.js';
import { ApiError } from '../../utils/errors.js';

async function findOrCreatePerson(personData) {
  const existing = await Person.findOne({ dni: personData.dni });
  if (existing) return existing;
  const person = new Person(personData);
  return person.save();
}

export async function createStudentService({ person, familyId, entryDate, notes }) {
  const family = await Family.findById(familyId);
  if (!family) {
    throw new ApiError(404, 'Familia no encontrada');
  }
  const personDoc = await findOrCreatePerson(person);
  // Verificar si ya existe un estudiante con esa persona en la familia
  const existingStudent = await Student.findOne({ personId: personDoc._id, familyId });
  if (existingStudent) {
    return existingStudent;
  }
  const student = new Student({
    personId: personDoc._id,
    familyId: family._id,
    entryDate: entryDate ? new Date(entryDate) : undefined,
    notes,
  });
  await student.save();
  family.studentIds.push(student._id);
  await family.save();
  return Student.findById(student._id).populate('personId');
}

export async function findStudentByDniService(dni) {
  const person = await Person.findOne({ dni });
  if (!person) return null;
  const student = await Student.findOne({ personId: person._id }).populate('personId').populate('familyId');
  return student;
}