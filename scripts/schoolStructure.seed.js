import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { Campus } from '../src/models/campus.model.js';
import { Cycle } from '../src/models/cycle.model.js';
import { Classroom } from '../src/models/classroom.model.js';
import { BillingConcept } from '../src/models/billingConcept.model.js';
import { BillingSchedule } from '../src/models/billingSchedule.model.js';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI;


const SEED_DATA = {
  campuses: [
    {
      code: 'CIMAS',
      name: 'Colegio Cimas',
      isActive: true,
      notes: '',
    },
    {
      code: 'CIENCIAS_APLICADAS',
      name: 'Colegio Ciencias Aplicadas',
      isActive: true,
      notes: '',
    },
    {
      code: 'CIENCIAS',
      name: 'Colegio Ciencias',
      isActive: true,
      notes: '',
    },
  ],
  cycle: {
    type: 'SCHOOL_YEAR',
    name: 'Año Escolar 2026',
    year: 2026,
    startDate: '2026-03-02',
    endDate: '2026-12-18',
    isActive: true,
    notes: '',
  },
  billingConcepts: [
    { code: 'ENROLLMENT_FEE', name: 'Matrícula', isBlocking: true, isActive: true, notes: '' },
    { code: 'ADMISSION_FEE', name: 'Derecho de Ingreso', isBlocking: true, isActive: true, notes: '' },
    { code: 'TUITION', name: 'Pensión', isBlocking: true, isActive: true, notes: '' },
    { code: 'PLANNER', name: 'Agenda', isBlocking: false, isActive: true, notes: '' },
    { code: 'SCHOOL_BOOKS', name: 'Libros', isBlocking: true, isActive: true, notes: '' },
  ],
  billingSchedule: [
    { conceptCode: 'TUITION', monthIndex: 0, label: 'Marzo', dueDate: '2026-03-31' },
    { conceptCode: 'TUITION', monthIndex: 1, label: 'Abril', dueDate: '2026-04-30' },
    { conceptCode: 'TUITION', monthIndex: 2, label: 'Mayo', dueDate: '2026-05-31' },
    { conceptCode: 'TUITION', monthIndex: 3, label: 'Junio', dueDate: '2026-06-30' },
    { conceptCode: 'TUITION', monthIndex: 4, label: 'Julio', dueDate: '2026-07-31' },
    { conceptCode: 'TUITION', monthIndex: 5, label: 'Agosto', dueDate: '2026-08-31' },
    { conceptCode: 'TUITION', monthIndex: 6, label: 'Septiembre', dueDate: '2026-09-30' },
    { conceptCode: 'TUITION', monthIndex: 7, label: 'Octubre', dueDate: '2026-10-31' },
    { conceptCode: 'TUITION', monthIndex: 8, label: 'Noviembre', dueDate: '2026-11-30' },
    { conceptCode: 'TUITION', monthIndex: 9, label: 'Diciembre', dueDate: '2026-12-15' },
  ],
  classrooms: [
    // {
    //   campusCode: 'CIMAS',
    //   level: 'INITIAL',
    //   grade: '3',
    //   section: 'A',
    //   capacity: 30,
    //   displayName: '1° Primaria A - Cimas',
    //   isActive: true,
    //   notes: 'Ejemplo',
    // },
    // {
    //   campusCode: 'CIMAS',
    //   level: 'PRIMARY',
    //   grade: '1',
    //   section: 'A',
    //   capacity: 30,
    //   displayName: '1° Primaria A - Cimas',
    //   isActive: true,
    //   notes: 'Ejemplo',
    // },
    {
      campusCode: 'CIENCIAS_APLICADAS',
      level: 'INITIAL',
      grade: '3',
      section: 'A',
      capacity: 10,
      displayName: 'Inicial 3 añitos',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS_APLICADAS',
      level: 'INITIAL',
      grade: '4',
      section: 'A',
      capacity: 20,
      displayName: 'Inicial 4 añitos',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS_APLICADAS',
      level: 'INITIAL',
      grade: '5',
      section: 'A',
      capacity: 20,
      displayName: 'Inicial 5 añitos',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS_APLICADAS',
      level: 'PRIMARY',
      grade: '1',
      section: 'A',
      capacity: 24,
      displayName: '1°-A de Primaria',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS_APLICADAS',
      level: 'PRIMARY',
      grade: '1',
      section: 'B',
      capacity: 24,
      displayName: '1°-B de Primaria',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS_APLICADAS',
      level: 'PRIMARY',
      grade: '2',
      section: 'A',
      capacity: 28,
      displayName: '2°-A de Primaria',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS_APLICADAS',
      level: 'PRIMARY',
      grade: '2',
      section: 'B',
      capacity: 28,
      displayName: '2°-B de Primaria',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS_APLICADAS',
      level: 'PRIMARY',
      grade: '3',
      section: 'A',
      capacity: 28,
      displayName: '3°-A de Primaria',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS_APLICADAS',
      level: 'PRIMARY',
      grade: '3',
      section: 'B',
      capacity: 20,
      displayName: '3°-B de Primaria',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS_APLICADAS',
      level: 'PRIMARY',
      grade: '4',
      section: 'A',
      capacity: 30,
      displayName: '4°-A de Primaria',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS_APLICADAS',
      level: 'PRIMARY',
      grade: '4',
      section: 'B',
      capacity: 28,
      displayName: '4°-B de Primaria',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS_APLICADAS',
      level: 'PRIMARY',
      grade: '5',
      section: 'A',
      capacity: 24,
      displayName: '5°-A de Primaria',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS_APLICADAS',
      level: 'PRIMARY',
      grade: '5',
      section: 'B',
      capacity: 24,
      displayName: '5°-B de Primaria',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS_APLICADAS',
      level: 'PRIMARY',
      grade: '6',
      section: 'A',
      capacity: 28,
      displayName: '6°-A de Primaria',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS_APLICADAS',
      level: 'PRIMARY',
      grade: '6',
      section: 'B',
      capacity: 30,
      displayName: '6°-B de Primaria',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS',
      level: 'SECONDARY',
      grade: '1',
      section: 'A',
      capacity: 25,
      displayName: '1°-A de Secundaria',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS',
      level: 'SECONDARY',
      grade: '1',
      section: 'B',
      capacity: 24,
      displayName: '1°-B de Secundaria',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS',
      level: 'SECONDARY',
      grade: '1',
      section: 'E',
      capacity: 20,
      displayName: '1°-E de Secundaria',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS',
      level: 'SECONDARY',
      grade: '2',
      section: 'A',
      capacity: 24,
      displayName: '2°-A de Secundaria',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS',
      level: 'SECONDARY',
      grade: '2',
      section: 'B',
      capacity: 24,
      displayName: '2°-B de Secundaria',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS',
      level: 'SECONDARY',
      grade: '2',
      section: 'E',
      capacity: 20,
      displayName: '2°-E de Secundaria',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS',
      level: 'SECONDARY',
      grade: '3',
      section: 'A',
      capacity: 24,
      displayName: '3°-A de Secundaria',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS',
      level: 'SECONDARY',
      grade: '3',
      section: 'B',
      capacity: 24,
      displayName: '3°-B de Secundaria',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS',
      level: 'SECONDARY',
      grade: '3',
      section: 'E',
      capacity: 20,
      displayName: '3°-E de Secundaria',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS',
      level: 'SECONDARY',
      grade: '4',
      section: 'A',
      capacity: 24,
      displayName: '4°-A de Secundaria',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS',
      level: 'SECONDARY',
      grade: '4',
      section: 'B',
      capacity: 24,
      displayName: '4°-B de Secundaria',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS',
      level: 'SECONDARY',
      grade: '4',
      section: 'E',
      capacity: 26,
      displayName: '4°-E de Secundaria',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS',
      level: 'SECONDARY',
      grade: '5',
      section: 'A',
      capacity: 20,
      displayName: '5°-A de Secundaria',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS',
      level: 'SECONDARY',
      grade: '5',
      section: 'B',
      capacity: 31,
      displayName: '5°-B de Secundaria',
      isActive: true,
      notes: '',
    },
    {
      campusCode: 'CIENCIAS',
      level: 'SECONDARY',
      grade: '5',
      section: 'E',
      capacity: 20,
      displayName: '5°-E de Secundaria',
      isActive: true,
      notes: '',
    },
  ],
};

async function upsertCampuses(campusesInput) {
  const campusMap = new Map();

  for (const campusData of campusesInput) {
    const campus = await Campus.findOneAndUpdate(
      { code: campusData.code },
      {
        $set: {
          name: campusData.name,
          isActive: campusData.isActive ?? true,
          notes: campusData.notes,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    campusMap.set(campus.code, campus);
    console.log(`✅ Campus listo: ${campus.code} (${campus.name})`);
  }

  return campusMap;
}

async function upsertCurrentCycle(cycleInput) {
  const cycle = await Cycle.findOneAndUpdate(
    { type: cycleInput.type, year: cycleInput.year },
    {
      $set: {
        name: cycleInput.name,
        startDate: new Date(cycleInput.startDate),
        endDate: new Date(cycleInput.endDate),
        isActive: cycleInput.isActive ?? true,
        notes: cycleInput.notes,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log(`✅ Cycle listo: ${cycle.type} ${cycle.year} (${cycle.name})`);
  return cycle;
}

async function upsertBillingConcepts(conceptsInput) {
  for (const conceptData of conceptsInput) {
    const concept = await BillingConcept.findOneAndUpdate(
      { code: conceptData.code },
      {
        $set: {
          name: conceptData.name,
          isBlocking: conceptData.isBlocking ?? false,
          isActive: conceptData.isActive ?? true,
          notes: conceptData.notes,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log(`âœ… Concepto de cobro listo: ${concept.code} (${concept.name})`);
  }
}

async function upsertBillingSchedule(scheduleInput, cycle) {
  for (const scheduleData of scheduleInput) {
    const schedule = await BillingSchedule.findOneAndUpdate(
      {
        cycleId: cycle._id,
        conceptCode: scheduleData.conceptCode,
        monthIndex: scheduleData.monthIndex ?? null,
      },
      {
        $set: {
          label: scheduleData.label || '',
          dueDate: new Date(scheduleData.dueDate),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log(`âœ… Calendario listo: ${schedule.conceptCode} ${schedule.label || (schedule.monthIndex ?? 'general')}`);
  }
}

async function ensureClassroomIndexes() {
  const legacyIndexName = 'campusId_1_cycleId_1_grade_1_section_1';
  const indexes = await Classroom.collection.indexes();
  const hasLegacyIndex = indexes.some((index) => index.name === legacyIndexName);

  if (hasLegacyIndex) {
    await Classroom.collection.dropIndex(legacyIndexName);
    console.log('Legacy classroom index eliminado para incluir level en la unicidad');
  }

  await Classroom.syncIndexes();
}

async function upsertClassrooms(classroomsInput, campusMap, cycle) {
  for (const classroomData of classroomsInput) {
    const campus = campusMap.get(classroomData.campusCode);

    if (!campus) {
      throw new Error(`No existe campus para campusCode='${classroomData.campusCode}'`);
    }

    const query = {
      campusId: campus._id,
      cycleId: cycle._id,
      level: classroomData.level,
      grade: classroomData.grade,
      section: classroomData.section,
    };

    await Classroom.findOneAndUpdate(
      query,
      {
        $set: {
          level: classroomData.level,
          capacity: classroomData.capacity,
          displayName: classroomData.displayName,
          isActive: classroomData.isActive ?? true,
          notes: classroomData.notes,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log(
      `✅ Salón listo: ${classroomData.displayName} [${classroomData.campusCode}]`
    );
  }
}

async function seedSchoolStructure() {
  try {
    if (!MONGO_URI) {
      throw new Error('Falta MONGODB_URI en variables de entorno');
    }

    console.log('🔌 Conectando a la base de datos...');
    await mongoose.connect(MONGO_URI);

    const campusMap = await upsertCampuses(SEED_DATA.campuses);
    const cycle = await upsertCurrentCycle(SEED_DATA.cycle);
    await upsertBillingConcepts(SEED_DATA.billingConcepts);
    await upsertBillingSchedule(SEED_DATA.billingSchedule, cycle);
    await ensureClassroomIndexes();
    await upsertClassrooms(SEED_DATA.classrooms, campusMap, cycle);

    console.log('🎉 Seed de estructura escolar finalizado correctamente');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error ejecutando seed de estructura escolar:', error);
    process.exit(1);
  }
}

seedSchoolStructure();
