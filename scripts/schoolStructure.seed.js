import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { Campus } from '../src/models/campus.model.js';
import { Cycle } from '../src/models/cycle.model.js';
import { Classroom } from '../src/models/classroom.model.js';

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

async function upsertClassrooms(classroomsInput, campusMap, cycle) {
  for (const classroomData of classroomsInput) {
    const campus = campusMap.get(classroomData.campusCode);

    if (!campus) {
      throw new Error(`No existe campus para campusCode='${classroomData.campusCode}'`);
    }

    const query = {
      campusId: campus._id,
      cycleId: cycle._id,
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
    await upsertClassrooms(SEED_DATA.classrooms, campusMap, cycle);

    console.log('🎉 Seed de estructura escolar finalizado correctamente');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error ejecutando seed de estructura escolar:', error);
    process.exit(1);
  }
}

seedSchoolStructure();
