import mongoose from 'mongoose';
import { Person } from '../../models/person.model.js';
import { Student } from '../../models/student.model.js';
import { Tutor } from '../../models/tutor.model.js';
import { Family } from '../../models/family.model.js';
import { Matricula } from '../../models/matricula.model.js';
import { Vacancy } from '../../models/vacancy.model.js';
import { ContractSnapshot } from '../../models/contractSnapshot.model.js';
import { Charge } from '../../models/charge.model.js';
import { Cycle } from '../../models/cycle.model.js';
import { Campus } from '../../models/campus.model.js';
import { Classroom } from '../../models/classroom.model.js';
import { StudentCycle } from '../../models/studentCycle.model.js';
import { ApiError } from '../../utils/errors.js';

// Encuentra o crea una persona en sesión
async function findOrCreatePersonSession(personData, session) {
  const existing = await Person.findOne({ dni: personData.dni }).session(session);
  if (existing) return existing;
  const person = new Person(personData);
  await person.save({ session });
  return person;
}

async function createQuickEnrollmentService(data, createdByUserId) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const student = await Student.findById(data.studentId).session(session);
    if (!student) throw new ApiError(404, 'Estudiante no encontrado');

    const cycle = await Cycle.findById(data.cycleId).session(session);
    if (!cycle) throw new ApiError(404, 'Ciclo no encontrado');

    const classroom = await Classroom.findById(data.classroomId).session(session);
    if (!classroom) throw new ApiError(404, 'Classroom no encontrado');

    if (!student.familyId) throw new ApiError(400, 'El estudiante no tiene familia vinculada');

    const existing = await Matricula.findOne({
      cycleId: cycle._id,
      studentIds: student._id,
      status: 'CONFIRMED',
    }).session(session);

    if (existing) throw new ApiError(409, 'El estudiante ya tiene matrícula confirmada en este ciclo');

    const matricula = new Matricula({
      familyId: student.familyId,
      cycleId: cycle._id,
      campusId: classroom.campusId,
      studentIds: [student._id],
      enrolledAt: new Date(),
      status: 'CONFIRMED',
      createdByUserId,
      originSchool: data.source,
      notes: data.notes || undefined,
    });

    await matricula.save({ session });

    await Vacancy.updateOne(
      { studentId: student._id, cycleId: cycle._id },
      {
        $set: {
          classroomId: classroom._id,
          endDate: null,
          notes: data.notes || undefined,
        },
        $setOnInsert: {
          studentId: student._id,
          cycleId: cycle._id,
          startDate: new Date(),
        },
      },
      { upsert: true, session }
    );

    await StudentCycle.updateOne(
      { studentId: student._id, cycleId: cycle._id, campusId: classroom.campusId },
      {
        $set: {
          status: 'ENROLLED',
          enrolledAt: new Date(),
          matriculaId: matricula._id,
          notes: data.notes || undefined,
        },
      },
      { upsert: true, session }
    );

    await session.commitTransaction();

    return {
      enrollment: {
        id: matricula._id.toString(),
        studentId: student._id.toString(),
        cycleId: cycle._id.toString(),
        classroomId: classroom._id.toString(),
        status: 'CONFIRMED',
        createdAt: matricula.enrolledAt,
      },
    };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

async function createLegacyEnrollmentService(data, createdByUserId) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // Verificar ciclo
    const cycle = await Cycle.findById(data.cycleId).session(session);
    if (!cycle) {
      throw new ApiError(404, 'Ciclo no encontrado');
    }
    if (cycle.type !== 'SCHOOL_YEAR') {
      throw new ApiError(400, 'Solo se permiten matrículas en ciclos de año escolar');
    }
    // Verificar campus
    const campus = await Campus.findById(data.campusId).session(session);
    if (!campus) {
      throw new ApiError(404, 'Campus no encontrado');
    }
    // Crear familia
    const family = new Family({ notes: data.notes || undefined, tutorIds: [], studentIds: [] });
    await family.save({ session });
    // Procesar estudiantes
    for (const stu of data.students) {
      // Crear o buscar persona del estudiante
      const personDoc = await findOrCreatePersonSession(stu.person, session);
      // Crear estudiante
      const student = new Student({ personId: personDoc._id, familyId: family._id, isActive: true });
      await student.save({ session });
      family.studentIds.push(student._id);
      // Procesar tutores
      for (const tut of stu.tutors) {
        const tutorPerson = await findOrCreatePersonSession(tut.person, session);
        const tutorDoc = new Tutor({
          studentId: student._id,
          tutorPersonId: tutorPerson._id,
          relationship: tut.relationship,
          isPrimary: tut.isPrimary ?? false,
          livesWithStudent: tut.livesWithStudent ?? true,
        });
        await tutorDoc.save({ session });
        family.tutorIds.push(tutorDoc._id);
      }
      // Crear vacante
      const vacancy = new Vacancy({
        studentId: student._id,
        cycleId: data.cycleId,
        classroomId: stu.classroomId,
        startDate: new Date(),
      });
      await vacancy.save({ session });
      // Crear cargos iniciales si existen
      if (stu.charges) {
        for (const ch of stu.charges) {
          const charge = new Charge({
            studentId: student._id,
            cycleId: data.cycleId,
            conceptId: ch.conceptId,
            description: ch.description,
            totalAmount: mongoose.Types.Decimal128.fromString(ch.amount.toString()),
            outstandingAmount: mongoose.Types.Decimal128.fromString(ch.amount.toString()),
            dueDate: ch.dueDate ? new Date(ch.dueDate) : undefined,
            status: 'OPEN',
          });
          await charge.save({ session });
        }
      }
    }
    // Guardar familia con listas actualizadas
    await family.save({ session });
    // Crear matrícula
    const matricula = new Matricula({
      familyId: family._id,
      cycleId: data.cycleId,
      campusId: data.campusId,
      studentIds: family.studentIds,
      enrolledAt: new Date(),
      status: 'CONFIRMED',
      createdByUserId,
      originSchool: data.originSchool,
      notes: data.notes || undefined,
    });
    await matricula.save({ session });
    // Crear snapshot de contrato
    const contractSnapshot = new ContractSnapshot({
      matriculaId: matricula._id,
      contractNumber: data.contractNumber,
      createdAt: new Date(),
      isSigned: false,
    });
    await contractSnapshot.save({ session });
    await session.commitTransaction();
    // Poblar resultado
    const result = await Matricula.findById(matricula._id)
      .populate({ path: 'familyId', populate: [
        { path: 'studentIds', populate: { path: 'personId' } },
        { path: 'tutorIds', populate: { path: 'tutorPersonId' } },
      ] })
      .populate('cycleId')
      .populate('campusId');
    return result;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

export async function createEnrollmentService(data, createdByUserId) {
  if (data.studentId) {
    return createQuickEnrollmentService(data, createdByUserId);
  }
  return createLegacyEnrollmentService(data, createdByUserId);
}

export async function getEnrollmentService(id) {
  const mat = await Matricula.findById(id)
    .populate({ path: 'familyId', populate: [
      { path: 'studentIds', populate: { path: 'personId' } },
      { path: 'tutorIds', populate: { path: 'tutorPersonId' } },
    ] })
    .populate('cycleId')
    .populate('campusId');
  if (!mat) {
    throw new ApiError(404, 'Matrícula no encontrada');
  }
  return mat;
}
