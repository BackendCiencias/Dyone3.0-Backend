import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { z } from 'zod';

import { connectDB } from '../src/config/db.js';
import { Campus } from '../src/models/campus.model.js';
import { Cycle } from '../src/models/cycle.model.js';
import { Classroom } from '../src/models/classroom.model.js';
import { Person } from '../src/models/person.model.js';
import { Family } from '../src/models/family.model.js';
import { Student } from '../src/models/student.model.js';
import { StudentCycle } from '../src/models/studentCycle.model.js';
import { Vacancy } from '../src/models/vacancy.model.js';

const genderSchema = z.enum(['M', 'F']).or(z.enum(['m', 'f'])).transform((value) => value.toUpperCase());

const rowSchema = z.object({
  internalCode: z.string().trim().min(1, 'Código interno es obligatorio'),
  lastNames: z.string().min(1, 'Apellidos es obligatorio'),
  names: z.string().min(1, 'Nombres es obligatorio'),
  dni: z.string().trim().optional().or(z.literal('')),
  gender: genderSchema.optional().or(z.literal('')).transform((value) => (value ? value.toUpperCase() : undefined)),
  campusText: z.string().trim().optional().or(z.literal('')),
  grade: z.string().min(1, 'Grado es obligatorio'),
  section: z.string().min(1, 'Sección es obligatoria'),
  level: z.enum(['PRIMARY', 'SECONDARY']),
  notes: z.string().optional().or(z.literal('')),
});

function parseArgs(argv) {
  const args = {};

  for (let i = 2; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith('--')) continue;

    const key = current.slice(2);
    const value = argv[i + 1];

    if (!value || value.startsWith('--')) {
      args[key] = true;
      continue;
    }

    args[key] = value;
    i += 1;
  }

  return args;
}

function normalizeHeader(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function splitLine(line, delimiter) {
  return line.split(delimiter).map((v) => v.trim());
}

function parseCSV(content) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (!lines.length) return [];

  const headerLine = lines[0];

  const count = (str, ch) => (str.match(new RegExp(`\\${ch}`, 'g')) || []).length;

  const tabCount = count(headerLine, '\t');
  const commaCount = count(headerLine, ',');
  const semiCount = count(headerLine, ';');


  let delimiter = ',';
  const max = Math.max(tabCount, commaCount, semiCount);

  if (max === tabCount) delimiter = '\t';
  else if (max === semiCount) delimiter = ';';
  

  const headers = splitLine(headerLine, delimiter).map(normalizeHeader);

  return lines.slice(1).map((line, index) => {
    const values = splitLine(line, delimiter);
    const raw = {};

    headers.forEach((header, i) => {
      raw[header] = values[i] || '';
    });

    return {
      rowNumber: index + 2,
      raw,
    };
  });
}

function normalizeDni(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return undefined;

  const lowered = normalized.toLowerCase();
  if (['null', 'undefined', 'n/a', 'na', '-'].includes(lowered)) {
    return undefined;
  }

  return normalized;
}

function normalizeLastNames(input) {
  return String(input || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleUpperCase('es-PE');
}

function normalizeNames(input) {
  return String(input || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es-PE')
    .split(' ')
    .filter(Boolean)
    .map((token) => token.charAt(0).toLocaleUpperCase('es-PE') + token.slice(1))
    .join(' ');
}


function mapRow(rawRow) {
  return {
    internalCode: (rawRow.internalcode || '').trim(),
    lastNames: (rawRow.apellidos || '').trim(),
    names: (rawRow.nombres || '').trim(),
    dni: normalizeDni(rawRow.dni),
    gender: (rawRow.genero || '').trim(),
    campusText: (rawRow.sede || '').trim(),
    grade: String(rawRow.grado || '').trim(),
    section: String(rawRow.seccion || '').trim().toUpperCase(),
    level: (rawRow.nivel || '').trim().toUpperCase(),
    notes: (rawRow.notas || '').trim(),
  };
}

async function resolveCampusAndCycle({ campusArg, cycleArg, campusText, level, grade, section }) {
  let campus = null;
  let cycle = null;

  if (campusArg) {
    if (!mongoose.Types.ObjectId.isValid(campusArg)) {
      throw new Error('El parámetro --campus no es un ObjectId válido');
    }
    campus = await Campus.findById(campusArg);
    if (!campus) throw new Error('No existe Campus para el parámetro --campus');
  } else {
    if (!campusText) throw new Error('No se pudo resolver Campus: falta Sede o parámetro --campus');
    const normalized = campusText.toUpperCase();

    campus = await Campus.findOne({ code: normalized });

    if (!campus) {
      campus = await Campus.findOne({ name: new RegExp(`^${campusText}$`, 'i') });
    }

    if (!campus) {
      const aliases = {};

      const alias = aliases[normalized];
      if (alias) {
        campus = await Campus.findOne({ code: alias });
      }
    }

    if (!campus) throw new Error(`No se encontró campus para Sede="${campusText}"`);
  }

  if (cycleArg) {
    if (!mongoose.Types.ObjectId.isValid(cycleArg)) {
      throw new Error('El parámetro --cycle no es un ObjectId válido');
    }

    cycle = await Cycle.findById(cycleArg);
    if (!cycle) throw new Error('No existe Cycle para el parámetro --cycle');
  } else {
    const classroomWithCycle = await Classroom.findOne({
      campusId: campus._id,
      level,
      grade,
      section,
      isActive: true,
    }).lean();

    if (!classroomWithCycle) {
      throw new Error('No se pudo inferir Cycle: no hay aula activa que coincida para la fila');
    }

    cycle = await Cycle.findById(classroomWithCycle.cycleId);
    if (!cycle) throw new Error('No se pudo inferir Cycle: el aula encontrada no tiene ciclo válido');
  }

  return { campus, cycle };
}

async function ensureFamilyStub(studentId) {
  const family = await Family.create({
    tutorIds: [],
    studentIds: studentId ? [studentId] : [],
    notes: 'Creado automáticamente por importación inicial.',
  });

  return family;
}

async function run() {
  const args = parseArgs(process.argv);

  if (!args.file) {
    console.error('Uso: node scripts/importStudents.js --file ./students.csv [--campus <ObjectId>] [--cycle <ObjectId>]');
    process.exit(1);
  }

  const filePath = path.resolve(process.cwd(), args.file);
  if (!fs.existsSync(filePath)) {
    console.error(`Archivo no encontrado: ${filePath}`);
    process.exit(1);
  }

  await connectDB();

  console.log('Campus codes:', (await Campus.find({}, { code: 1 }).lean()).map(c => c.code));


  const report = {
    totalRows: 0,
    created: 0,
    updated: 0,
    errors: 0,
  };

  const successRows = [];
  const errorRows = [];

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const rows = parseCSV(content);
    report.totalRows = rows.length;

    for (const row of rows) {
      const mapped = mapRow(row.raw);
      const parsed = rowSchema.safeParse(mapped);

      if (!parsed.success) {
        report.errors += 1;
        errorRows.push({
          rowNumber: row.rowNumber,
          internalCode: mapped.internalCode || null,
          reason: parsed.error.issues.map((issue) => issue.message).join('; '),
        });
        continue;
      }

      const data = parsed.data;

      try {
        const { campus, cycle } = await resolveCampusAndCycle({
          campusArg: args.campus,
          cycleArg: args.cycle,
          campusText: data.campusText,
          level: data.level,
          grade: data.grade,
          section: data.section,
        });

        const classroom = await Classroom.findOne({
          campusId: campus._id,
          cycleId: cycle._id,
          level: data.level,
          grade: data.grade,
          section: data.section,
          isActive: true,
        });

        if (!classroom) {
          throw new Error('No existe aula para campus + ciclo + nivel + grado + sección');
        }

        let student = await Student.findOne({ internalCode: data.internalCode });
        let createdSomething = false;
        let updatedSomething = false;

        let person = null;
        if (data.dni) {
          person = await Person.findOne({ dni: data.dni });
        }

        if (!person && student) {
          person = await Person.findById(student.personId);
        }

        if (!person) {
          if (!data.gender) {
            throw new Error('Género es obligatorio (M/F) para crear persona nueva');
          }

          person = await Person.create({
            names: normalizeNames(data.names),
            lastNames: normalizeLastNames(data.lastNames),
            ...(data.dni ? { dni: data.dni } : {}),
            gender: data.gender,
          });
          createdSomething = true;
        } else {
          const personSetUpdates = {};
          const personUnsetUpdates = {};

          const normalizedNames = normalizeNames(data.names);
          const normalizedLastNames = normalizeLastNames(data.lastNames);

          if (person.names !== normalizedNames) personSetUpdates.names = normalizedNames;
          if (person.lastNames !== normalizedLastNames) personSetUpdates.lastNames = normalizedLastNames;
          if (data.gender && person.gender !== data.gender) personSetUpdates.gender = data.gender;

          if (data.dni && person.dni !== data.dni) {
            personSetUpdates.dni = data.dni;
          }

          if (!data.dni && (person.dni === null || typeof person.dni === 'string')) {
            personUnsetUpdates.dni = '';
          }

          if (Object.keys(personSetUpdates).length || Object.keys(personUnsetUpdates).length) {
            const updateDoc = {};
            if (Object.keys(personSetUpdates).length) updateDoc.$set = personSetUpdates;
            if (Object.keys(personUnsetUpdates).length) updateDoc.$unset = personUnsetUpdates;
            await Person.updateOne({ _id: person._id }, updateDoc);
            updatedSomething = true;
          }
        }

        if (!student) {
          const family = await ensureFamilyStub(null);

          student = await Student.create({
            personId: person._id,
            familyId: family._id,
            internalCode: data.internalCode,
            internalNotes: data.notes || undefined,
          });

          await Family.updateOne({ _id: family._id }, { $addToSet: { studentIds: student._id } });
          createdSomething = true;
        } else {
          const studentUpdates = {};
          if (String(student.personId) !== String(person._id)) studentUpdates.personId = person._id;
          if (data.notes && student.internalNotes !== data.notes) studentUpdates.internalNotes = data.notes;

          if (Object.keys(studentUpdates).length) {
            await Student.updateOne({ _id: student._id }, { $set: studentUpdates });
            updatedSomething = true;
          }
        }

        if (!student.familyId) {
          const family = await ensureFamilyStub(student._id);
          await Student.updateOne({ _id: student._id }, { $set: { familyId: family._id } });
          createdSomething = true;
        } else {
          await Family.updateOne(
            { _id: student.familyId },
            {
              $addToSet: { studentIds: student._id },
            }
          );
        }

        const studentCycle = await StudentCycle.findOne({
          studentId: student._id,
          cycleId: cycle._id,
          campusId: campus._id,
        });

        if (!studentCycle) {
          await StudentCycle.create({
            studentId: student._id,
            cycleId: cycle._id,
            campusId: campus._id,
            status: 'ABSENT',
          });
          createdSomething = true;
        }

        const vacancy = await Vacancy.findOne({ studentId: student._id, cycleId: cycle._id });
        if (!vacancy) {
          await Vacancy.create({
            studentId: student._id,
            cycleId: cycle._id,
            classroomId: classroom._id,
          });
          createdSomething = true;
        } else {
          const vacancyUpdates = {};
          if (String(vacancy.classroomId) !== String(classroom._id)) vacancyUpdates.classroomId = classroom._id;

          if (Object.keys(vacancyUpdates).length) {
            await Vacancy.updateOne({ _id: vacancy._id }, { $set: vacancyUpdates });
            updatedSomething = true;
          }
        }

        if (createdSomething) report.created += 1;
        else if (updatedSomething) report.updated += 1;

        successRows.push({
          rowNumber: row.rowNumber,
          internalCode: data.internalCode,
          studentId: student._id,
          personId: person._id,
          classroomId: classroom._id,
          cycleId: cycle._id,
          campusId: campus._id,
        });
      } catch (error) {
        report.errors += 1;
        errorRows.push({
          rowNumber: row.rowNumber,
          internalCode: data.internalCode || null,
          reason: error.message,
        });
      }
    }

    const logsDir = path.resolve(process.cwd(), 'logs');
    fs.mkdirSync(logsDir, { recursive: true });

    fs.writeFileSync(
      path.join(logsDir, 'import-students-success.json'),
      JSON.stringify(successRows, null, 2),
      'utf8'
    );

    fs.writeFileSync(
      path.join(logsDir, 'import-students-errors.json'),
      JSON.stringify(errorRows, null, 2),
      'utf8'
    );

    console.log('===== Import Students Summary =====');
    console.log(`Total filas: ${report.totalRows}`);
    console.log(`Creados: ${report.created}`);
    console.log(`Actualizados: ${report.updated}`);
    console.log(`Errores: ${report.errors}`);
    console.log(`Logs: ${logsDir}`);

    process.exit(0);
  } catch (error) {
    console.error('Error ejecutando importStudents:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
}

run();
