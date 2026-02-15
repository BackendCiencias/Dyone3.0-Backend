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
import { Counter } from '../../models/counter.model.js';
import { ApiError } from '../../utils/errors.js';
import { runInTransaction } from '../../shared/dbSession.js';
import { registerAuditLog } from '../../shared/audit.service.js';

async function nextStudentCodeSession(session) {
  const counter = await Counter.findOneAndUpdate(
    { key: 'student_internal_code' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session }
  );

  return `COD_A${String(counter.seq).padStart(5, '0')}`;
}

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
      // Crear estudiante o reutilizar existente
      let student = await Student.findOne({ personId: personDoc._id }).session(session);
      if (!student) {
        student = new Student({
          personId: personDoc._id,
          familyId: family._id,
          internalCode: await nextStudentCodeSession(session),
          isActive: true,
        });
        await student.save({ session });
      } else if (!student.internalCode) {
        student.internalCode = await nextStudentCodeSession(session);
        student.familyId = family._id;
        await student.save({ session });
      }
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

export async function getClassroomCapacityService({ classroomId, cycleId }) {
  if (!mongoose.Types.ObjectId.isValid(classroomId)) {
    throw new ApiError(400, 'classroomId inválido');
  }

  if (!mongoose.Types.ObjectId.isValid(cycleId)) {
    throw new ApiError(400, 'cycleId inválido');
  }

  const classroom = await Classroom.findById(classroomId).lean();
  if (!classroom) {
    throw new ApiError(404, 'Salón no encontrado');
  }

  if (String(classroom.cycleId) !== String(cycleId)) {
    throw new ApiError(400, 'El salón no pertenece al ciclo indicado');
  }

  const reservedCount = await Vacancy.countDocuments({
    classroomId: classroom._id,
    cycleId,
    endDate: null,
  });

  const totalCapacity = classroom.capacity;

  return {
    classroomId: classroom._id.toString(),
    totalCapacity,
    reservedCount,
    availableCount: Math.max(totalCapacity - reservedCount, 0),
  };
}

export async function getCampusCapacityService({ campusId, cycleId }) {
  if (!mongoose.Types.ObjectId.isValid(campusId)) {
    throw new ApiError(400, 'campusId inválido');
  }

  if (!mongoose.Types.ObjectId.isValid(cycleId)) {
    throw new ApiError(400, 'cycleId inválido');
  }

  const classrooms = await Classroom.find({ campusId, cycleId, isActive: true })
    .select('_id level grade section capacity')
    .lean();

  const reservedByClassroom = await Vacancy.aggregate([
    {
      $match: {
        cycleId: new mongoose.Types.ObjectId(cycleId),
        endDate: null,
      },
    },
    {
      $group: {
        _id: '$classroomId',
        reservedCount: { $sum: 1 },
      },
    },
  ]);

  const reservedMap = new Map(
    reservedByClassroom.map((entry) => [String(entry._id), entry.reservedCount])
  );

  return classrooms.map((classroom) => {
    const reservedCount = reservedMap.get(String(classroom._id)) || 0;
    const totalCapacity = classroom.capacity;

    return {
      classroomId: classroom._id.toString(),
      level: classroom.level,
      grade: classroom.grade,
      section: classroom.section,
      totalCapacity,
      reservedCount,
      availableCount: Math.max(totalCapacity - reservedCount, 0),
    };
  });
}


export async function confirmEnrollmentService({ enrollmentId, payload, userId }) {
  const result = await runInTransaction(async (session) => {
    const matricula = await Matricula.findById(enrollmentId).session(session);
    if (!matricula) throw new ApiError(404, 'Matrícula no encontrada');

    if (matricula.status === 'CONFIRMED') {
      throw new ApiError(409, 'La matrícula ya fue confirmada');
    }
    if (matricula.status !== 'DRAFT') {
      throw new ApiError(409, 'El estado actual de matrícula no permite confirmación');
    }

    const cycle = await Cycle.findById(payload.cycleId).session(session);
    if (!cycle) throw new ApiError(404, 'Ciclo no encontrado');

    const campus = await Campus.findById(payload.campusId).session(session);
    if (!campus) throw new ApiError(404, 'Campus no encontrado');

    const studentIds = payload.students.map((row) => row.studentId);
    const studentCount = await Student.countDocuments({ _id: { $in: studentIds } }).session(session);
    if (studentCount !== studentIds.length) throw new ApiError(404, 'Hay estudiantes que no existen');

    let snapshot = await ContractSnapshot.findOne({ matriculaId: matricula._id }).session(session);

    const snapshotData = {
      cycleId: payload.cycleId,
      campusId: payload.campusId,
      students: payload.students,
      discounts: payload.discounts || undefined,
      exemptions: payload.exemptions || undefined,
      notes: payload.notes || undefined,
      confirmedByUserId: userId,
      confirmedAt: new Date(),
    };

    if (!snapshot) {
      snapshot = new ContractSnapshot({ matriculaId: matricula._id, ...snapshotData });
      await snapshot.save({ session });
    } else {
      await ContractSnapshot.updateOne({ _id: snapshot._id }, { $set: snapshotData }, { session });
    }

    await Matricula.updateOne(
      { _id: matricula._id },
      { $set: { status: 'CONFIRMED', enrolledAt: matricula.enrolledAt || new Date() } },
      { session }
    );

    for (const row of payload.students) {
      await StudentCycle.findOneAndUpdate(
        { studentId: row.studentId, cycleId: payload.cycleId, campusId: payload.campusId },
        {
          $set: { status: 'ENROLLED', enrolledAt: new Date(), matriculaId: matricula._id },
          $setOnInsert: { studentId: row.studentId, cycleId: payload.cycleId, campusId: payload.campusId },
        },
        { upsert: true, new: true, session }
      );
    }

    return {
      enrollmentId: matricula._id.toString(),
      campusId: matricula.campusId,
      status: 'CONFIRMED',
      snapshotSaved: true,
      chargeGenerationPending: true,
    };
  });

  await registerAuditLog({
    entityType: 'ENROLLMENT',
    entityId: result.enrollmentId,
    action: 'ENROLLMENT_CONFIRMED',
    performedBy: userId,
    campusId: result.campusId,
    payloadSnapshot: payload,
  });

  return {
    enrollmentId: result.enrollmentId,
    status: result.status,
    snapshotSaved: result.snapshotSaved,
    chargeGenerationPending: result.chargeGenerationPending,
  };
}


function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toObjectIdOrNull(value) {
  if (!value) return null;
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : null;
}

export async function listEnrollmentsService({ q, campus, cycleId, status, classroomId, limit = 20, cursor, campusScope = [] }) {
  const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 20));

  const where = {};
  const isGlobalScope = Array.isArray(campusScope) && campusScope.includes('*');
  if (!isGlobalScope && Array.isArray(campusScope) && campusScope.length) {
    const scopedCampuses = await Campus.find({
      $or: [
        { code: { $in: campusScope } },
        { _id: { $in: campusScope.filter((value) => mongoose.Types.ObjectId.isValid(value)).map((value) => new mongoose.Types.ObjectId(value)) } },
      ],
    }).select('_id code').lean();

    const scopeCampusIds = new Set(scopedCampuses.map((row) => String(row._id)));
    const scopeCampusCodes = new Set(scopedCampuses.map((row) => row.code));

    if (campus) {
      const normalizedCampus = String(campus);
      const allowed = scopeCampusIds.has(normalizedCampus) || scopeCampusCodes.has(normalizedCampus);
      if (!allowed) throw new ApiError(403, 'No autorizado para este campus');
    } else {
      where.campusId = { $in: [...scopeCampusIds].map((id) => new mongoose.Types.ObjectId(id)) };
      if (!scopeCampusIds.size) return { items: [], nextCursor: null };
    }
  }

  if (cycleId) where.cycleId = cycleId;
  if (campus) {
    const campusDoc = await Campus.findOne({
      $or: [{ _id: toObjectIdOrNull(campus) || null }, { code: campus }],
    }).select('_id').lean();
    if (!campusDoc) return { items: [], nextCursor: null };
    where.campusId = campusDoc._id;
  }

  if (cursor) {
    where._id = { $gt: cursor };
  }

  if (q) {
    const regex = new RegExp(escapeRegExp(String(q).trim()), 'i');
    const matchedPeople = await Person.find({ dni: regex }).select('_id').lean();
    const matchedStudents = await Student.find({
      $or: [
        { internalCode: regex },
        ...(matchedPeople.length ? [{ personId: { $in: matchedPeople.map((p) => p._id) } }] : []),
      ],
    }).select('_id').lean();

    if (!matchedStudents.length) return { items: [], nextCursor: null };
    where.studentIds = { $in: matchedStudents.map((s) => s._id) };
  }

  const rows = await Matricula.find(where)
    .sort({ _id: 1 })
    .limit(normalizedLimit + 1)
    .select('_id studentIds cycleId campusId status createdAt')
    .lean();

  const hasMore = rows.length > normalizedLimit;
  const selected = hasMore ? rows.slice(0, normalizedLimit) : rows;

  const studentIds = [...new Set(selected.flatMap((row) => row.studentIds.map((id) => String(id))))]
    .map((id) => new mongoose.Types.ObjectId(id));

  const [students, cycles, classrooms, studentCycles, snapshots] = await Promise.all([
    Student.find({ _id: { $in: studentIds } }).populate('personId').select('_id internalCode personId').lean(),
    Cycle.find({ _id: { $in: [...new Set(selected.map((row) => String(row.cycleId)))] } }).select('_id name').lean(),
    Vacancy.find({
      studentId: { $in: studentIds },
      endDate: null,
      ...(classroomId ? { classroomId } : {}),
    }).populate('classroomId', '_id displayName').select('studentId cycleId classroomId').lean(),
    StudentCycle.find({
      studentId: { $in: studentIds },
      ...(cycleId ? { cycleId } : {}),
      ...(status ? { status } : {}),
    }).select('studentId cycleId status').lean(),
    ContractSnapshot.find({ matriculaId: { $in: selected.map((row) => row._id) } }).select('matriculaId students discounts notes confirmedAt').lean(),
  ]);

  const studentsMap = new Map(students.map((s) => [String(s._id), s]));
  const cycleMap = new Map(cycles.map((c) => [String(c._id), c]));
  const snapshotMap = new Map(snapshots.map((c) => [String(c.matriculaId), c]));
  const cycleStatusMap = new Map(studentCycles.map((c) => [`${String(c.studentId)}:${String(c.cycleId)}`, c.status]));
  const classroomMap = new Map(classrooms.map((c) => [`${String(c.studentId)}:${String(c.cycleId)}`, c.classroomId]));

  const items = [];
  for (const row of selected) {
    const cycle = cycleMap.get(String(row.cycleId));
    const snapshot = snapshotMap.get(String(row._id));

    for (const studentIdItem of row.studentIds) {
      const student = studentsMap.get(String(studentIdItem));
      if (!student) continue;

      const statusValue = cycleStatusMap.get(`${String(studentIdItem)}:${String(row.cycleId)}`) || 'ABSENT';
      if (status && statusValue !== status) continue;

      const classroom = classroomMap.get(`${String(studentIdItem)}:${String(row.cycleId)}`);
      if (classroomId && String(classroom?._id || classroom) !== String(classroomId)) continue;

      const snapshotStudent = snapshot?.students?.find((entry) => String(entry.studentId) === String(studentIdItem));

      items.push({
        enrollmentId: row._id.toString(),
        student: {
          id: student._id.toString(),
          names: student.personId?.names || null,
          lastNames: student.personId?.lastNames || null,
          dni: student.personId?.dni || null,
          code: student.internalCode || null,
        },
        campus: row.campusId?.toString(),
        cycle: cycle ? { id: cycle._id.toString(), name: cycle.name } : null,
        classroom: classroom ? { id: classroom._id.toString(), displayName: classroom.displayName } : null,
        status: statusValue,
        confirmedAt: snapshot?.confirmedAt || null,
        snapshot: {
          monthlyFee: snapshotStudent?.monthlyAmount ?? null,
          discount: snapshot?.discounts || null,
          notes: snapshot?.notes || null,
        },
      });
    }
  }

  const limitedItems = items.slice(0, normalizedLimit);

  return {
    items: limitedItems,
    nextCursor: hasMore ? selected[selected.length - 1]._id.toString() : null,
  };
}
