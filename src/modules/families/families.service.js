import { Family } from '../../models/family.model.js';
import { Person } from '../../models/person.model.js';
import { Student } from '../../models/student.model.js';
import { ApiError } from '../../utils/errors.js';

// Encuentra o crea una persona por DNI
async function findOrCreatePerson(personData) {
  const existing = await Person.findOne({ dni: personData.dni });
  if (existing) {
    return existing;
  }
  const person = new Person(personData);
  return person.save();
}

export async function createFamilyService({ tutors, students, notes }) {
  // Crear familia vacía
  const family = new Family({ notes, tutorIds: [], studentIds: [] });
  await family.save();
  // Crear estudiantes
  for (const stu of students) {
    const person = await findOrCreatePerson(stu);
    const studentDoc = new Student({ personId: person._id, familyId: family._id, isActive: true });
    await studentDoc.save();
    family.studentIds.push(studentDoc._id);
  }
  // Procesar tutores (solo crear personas, no crea Tutor docs aquí)
  for (const tut of tutors) {
    const person = await findOrCreatePerson(tut);
    // No se crea Tutor aquí; se guardará en matrícula
    // Pero se podría almacenar referencia a persona para saber quién es tutor
    // No agregamos a tutorIds en este servicio
  }
  await family.save();
  // Devolver la familia con estudiantes poblados
  return Family.findById(family._id).populate({ path: 'studentIds', populate: { path: 'personId' } });
}

export async function searchFamiliesByDniService(dni) {
  const person = await Person.findOne({ dni });
  if (!person) {
    return [];
  }
  // Buscar estudiantes con esa persona
  const students = await Student.find({ personId: person._id });
  if (!students.length) {
    return [];
  }
  // Buscar familias que contengan estos estudiantes
  const families = await Family.find({ studentIds: { $in: students.map((s) => s._id) } }).populate({ path: 'studentIds', populate: { path: 'personId' } });
  return families;
}