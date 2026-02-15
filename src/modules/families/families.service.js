import mongoose from 'mongoose';
import { Family } from '../../models/family.model.js';
import { Person } from '../../models/person.model.js';
import { Student } from '../../models/student.model.js';
import { Tutor } from '../../models/tutor.model.js';
import { Counter } from '../../models/counter.model.js';
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

async function nextStudentCode() {
  const counter = await Counter.findOneAndUpdate(
    { key: 'student_internal_code' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  return `COD_A${String(counter.seq).padStart(5, '0')}`;
}

function mapRelationship(value) {
  if (value === 'PADRE' || value === 'Padre') return 'Padre';
  if (value === 'MADRE' || value === 'Madre') return 'Madre';
  return 'Apoderado';
}

export async function createFamilyService({ tutors, students, notes }) {
  // Crear familia vacía
  const family = new Family({ notes, tutorIds: [], studentIds: [] });
  await family.save();
  // Crear estudiantes
  for (const stu of students) {
    const person = await findOrCreatePerson(stu);
    const existingStudent = await Student.findOne({ personId: person._id });
    const studentDoc = existingStudent || new Student({
      personId: person._id,
      familyId: family._id,
      internalCode: await nextStudentCode(),
      isActive: true,
    });
    if (!studentDoc.internalCode) {
      studentDoc.internalCode = await nextStudentCode();
    }
    await studentDoc.save();
    family.studentIds.push(studentDoc._id);
  }
  // Procesar tutores (solo crear personas, no crea Tutor docs aquí)
  for (const tut of tutors) {
    await findOrCreatePerson(tut);
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

export async function linkStudentFamilyService({ studentId, familyId, family }) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!mongoose.Types.ObjectId.isValid(studentId)) throw new ApiError(400, 'studentId inválido');

    const student = await Student.findById(studentId).session(session);
    if (!student) throw new ApiError(404, 'Estudiante no encontrado');

    let familyDoc;
    let created = false;

    if (familyId) {
      if (!mongoose.Types.ObjectId.isValid(familyId)) throw new ApiError(400, 'familyId inválido');
      familyDoc = await Family.findById(familyId).session(session);
      if (!familyDoc) throw new ApiError(404, 'Familia no encontrada');
    } else {
      const notes = [family?.address ? `Dirección: ${family.address}` : null, family?.campusId ? `Campus: ${family.campusId}` : null]
        .filter(Boolean)
        .join(' | ');
      familyDoc = new Family({
        tutorIds: [],
        studentIds: [],
        ...(notes ? { notes } : {}),
      });
      await familyDoc.save({ session });
      created = true;
    }

    await Student.updateOne(
      { _id: student._id },
      { $set: { familyId: familyDoc._id } },
      { session }
    );

    await Family.updateOne(
      { _id: familyDoc._id },
      { $addToSet: { studentIds: student._id } },
      { session }
    );

    if (family?.guardians?.length) {
      let isPrimaryAssigned = false;
      for (const guardian of family.guardians) {
        let person = null;
        if (guardian.dni) {
          person = await Person.findOne({ dni: guardian.dni.trim() }).session(session);
        }

        if (!person) {
          person = await Person.create([
            {
              names: guardian.names,
              lastNames: guardian.lastNames,
              dni: guardian.dni?.trim() || undefined,
              gender: 'Masculino',
              phone: guardian.phone,
              email: guardian.email,
            },
          ], { session }).then((docs) => docs[0]);
        }

        const relationship = mapRelationship(guardian.relationship);
        const tutor = await Tutor.findOneAndUpdate(
          { studentId: student._id, tutorPersonId: person._id, relationship },
          {
            $set: {
              studentId: student._id,
              tutorPersonId: person._id,
              relationship,
              isPrimary: !isPrimaryAssigned,
              livesWithStudent: true,
            },
          },
          { upsert: true, new: true, session }
        );

        isPrimaryAssigned = true;

        await Family.updateOne(
          { _id: familyDoc._id },
          { $addToSet: { tutorIds: tutor._id } },
          { session }
        );
      }
    }

    await session.commitTransaction();

    const hydratedFamily = await Family.findById(familyDoc._id)
      .populate({ path: 'tutorIds', populate: { path: 'tutorPersonId' } })
      .populate('studentIds')
      .lean();

    const mainTutor = hydratedFamily?.tutorIds?.find((t) => t.isPrimary);
    const guardianName = mainTutor?.tutorPersonId
      ? `${mainTutor.tutorPersonId.names} ${mainTutor.tutorPersonId.lastNames}`.trim()
      : null;

    return {
      created,
      familyId: familyDoc._id.toString(),
      family: {
        id: familyDoc._id.toString(),
        familyName: guardianName,
        mainGuardian: guardianName,
        guardiansCount: hydratedFamily?.tutorIds?.length || 0,
        studentIds: hydratedFamily?.studentIds?.map((s) => s._id.toString()) || [],
      },
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}


export async function getFamilyByIdService(familyId) {
  if (!mongoose.Types.ObjectId.isValid(familyId)) throw new ApiError(400, 'familyId inválido');

  const family = await Family.findById(familyId)
    .populate({ path: 'studentIds', populate: { path: 'personId' } })
    .populate({ path: 'tutorIds', populate: { path: 'tutorPersonId' } })
    .lean();

  if (!family) throw new ApiError(404, 'Familia no encontrada');

  return {
    family: {
      _id: family._id,
      notes: family.notes || null,
    },
    students: (family.studentIds || []).map((student) => ({
      _id: student._id,
      internalCode: student.internalCode || null,
      person: student.personId || null,
    })),
    tutors: (family.tutorIds || []).map((tutor) => ({
      _id: tutor._id,
      relationship: tutor.relationship,
      isPrimary: tutor.isPrimary,
      livesWithStudent: tutor.livesWithStudent,
      tutorPerson: tutor.tutorPersonId || null,
    })),
  };
}
