import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { z } from 'zod';

import { connectDB } from '../src/config/db.js';
import { Person } from '../src/models/person.model.js';
import { Student } from '../src/models/student.model.js';
import { Cycle } from '../src/models/cycle.model.js';
import { Campus } from '../src/models/campus.model.js';
import { Classroom } from '../src/models/classroom.model.js';
import { StudentCycle } from '../src/models/studentCycle.model.js';
import { Enrollment } from '../src/models/enrollment.model.js';
import { EnrollmentStudent, NO_APLICA_PENSION } from '../src/models/enrollmentStudent.model.js';

const genderSchema = z.enum(['M', 'F']).or(z.enum(['m', 'f'])).transform((value) => value.toUpperCase());
const levelSchema = z.enum(['INITIAL', 'PRIMARY', 'SECONDARY']);
const IMPORT_NOTES = 'Creado por importación inicial';
const SCHOOL_MONTHS = 10;

const rowSchema = z.object({
  internalCode: z.string().trim().min(1, 'Código interno es obligatorio'),
  lastNames: z.string().trim().min(1, 'Apellidos es obligatorio'),
  names: z.string().trim().min(1, 'Nombres es obligatorio'),
  dni: z.string().trim().optional().or(z.literal('')),
  gender: genderSchema,
  campusCode: z.enum(['CIENCIAS', 'CIENCIAS_APLICADAS', 'CIMAS']),
  grade: z.string().trim().min(1, 'Grado es obligatorio'),
  section: z.string().trim().min(1, 'Sección es obligatorio'),
  level: levelSchema,
  notes: z.string().trim().optional().or(z.literal('')),
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
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function maybeFixMojibake(value) {
  const text = String(value || '');
  if (!text) return { value: text, fixed: false };

  const hasMojibake = /Ã|Â|�/.test(text);
  if (!hasMojibake) return { value: text, fixed: false };

  const converted = Buffer.from(text, 'latin1').toString('utf8');
  const badness = (input) => (String(input).match(/Ã|Â|�/g) || []).length;

  if (badness(converted) < badness(text)) {
    return { value: converted, fixed: true };
  }

  return { value: text, fixed: false };
}

function splitLine(line, delimiter) {
  return line.split(delimiter).map((v) => maybeFixMojibake(v).value.trim());
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
  if (['null', 'undefined', 'n/a', 'na', '-'].includes(lowered)) return undefined;

  return normalized;
}

function normalizeSpaces(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeLastNames(input) {
  return normalizeSpaces(input).toLocaleUpperCase('es-PE');
}

function normalizeNames(input) {
  return normalizeSpaces(input)
    .toLocaleLowerCase('es-PE')
    .split(' ')
    .filter(Boolean)
    .map((token) => token.charAt(0).toLocaleUpperCase('es-PE') + token.slice(1))
    .join(' ');
}

function getByAliases(rawRow, aliases = []) {
  for (const alias of aliases) {
    if (rawRow[alias] !== undefined) return rawRow[alias];
  }
  return '';
}

function normalizeCampusCode(input) {
  return normalizeSpaces(input).toLocaleUpperCase('es-PE');
}

function normalizeGrade(input) {
  return normalizeSpaces(input).replace(/[°º]/g, '');
}

function normalizeSection(input) {
  return normalizeSpaces(input).toLocaleUpperCase('es-PE');
}

function normalizeLevel(input) {
  return normalizeSpaces(input).toLocaleUpperCase('es-PE');
}

function mapRow(rawRow, report, rowNumber) {
  const rawNotes = getByAliases(rawRow, ['notas', 'observaciones', 'informacion']);
  const fixedNotes = maybeFixMojibake(rawNotes);
  if (/Ã|Â|�/.test(rawNotes) && !fixedNotes.fixed) {
    report.warnings += 1;
    report.warningRows.push({
      rowNumber,
      reason: 'No se pudo corregir posible mojibake en notas; se guarda valor original',
    });
  }

  return {
    internalCode: normalizeSpaces(getByAliases(rawRow, ['internalcode', 'codigointerno', 'codigo'])),
    lastNames: normalizeSpaces(getByAliases(rawRow, ['apellidos', 'apellido', 'lastname', 'lastnames'])),
    names: normalizeSpaces(getByAliases(rawRow, ['nombres', 'nombre', 'name', 'names'])),
    dni: normalizeDni(getByAliases(rawRow, ['dni', 'documento', 'numerodocumento'])),
    gender: normalizeSpaces(getByAliases(rawRow, ['genero', 'sexo', 'gender'])),
    campusCode: normalizeCampusCode(getByAliases(rawRow, ['sede', 'campus', 'campuscode'])),
    grade: normalizeGrade(getByAliases(rawRow, ['grado', 'grade'])),
    section: normalizeSection(getByAliases(rawRow, ['seccion', 'seccia3n', 'section'])),
    level: normalizeLevel(getByAliases(rawRow, ['nivel', 'level'])),
    notes: normalizeSpaces(fixedNotes.value),
  };
}

async function findOrCreatePerson(data, report) {
  const normalizedNames = normalizeNames(data.names);
  const normalizedLastNames = normalizeLastNames(data.lastNames);

  let person = null;
  if (data.dni) {
    person = await Person.findOne({ dni: data.dni });
  }

  if (!person) {
    const candidates = await Person.find({
      names: normalizedNames,
      lastNames: normalizedLastNames,
    }).limit(2);

    if (candidates.length === 1) person = candidates[0];
  }

  if (!person) {
    try {
      const created = await Person.create({
        names: normalizedNames,
        lastNames: normalizedLastNames,
        ...(data.dni ? { dni: data.dni } : {}),
        gender: data.gender,
      });
      report.peopleCreated += 1;
      return created;
    } catch (error) {
      if (error?.code === 11000 && data.dni) {
        const existing = await Person.findOne({ dni: data.dni });
        if (existing) return existing;
      }
      throw error;
    }
  }

  const setUpdates = {};
  if (person.names !== normalizedNames) setUpdates.names = normalizedNames;
  if (person.lastNames !== normalizedLastNames) setUpdates.lastNames = normalizedLastNames;
  if (person.gender !== data.gender) setUpdates.gender = data.gender;
  if (data.dni && person.dni !== data.dni) setUpdates.dni = data.dni;

  if (Object.keys(setUpdates).length) {
    await Person.updateOne({ _id: person._id }, { $set: setUpdates });
    report.peopleUpdated += 1;
    person = await Person.findById(person._id);
  }

  return person;
}

async function upsertStudent(data, person, report) {
  const existing = await Student.findOne({ internalCode: data.internalCode });

  if (!existing) {
    const created = await Student.create({
      personId: person._id,
      internalCode: data.internalCode,
      isActive: true,
      ...(data.notes ? { internalNotes: data.notes } : {}),
    });
    report.studentsCreated += 1;
    return created;
  }

  const setUpdates = {};
  if (String(existing.personId) !== String(person._id)) setUpdates.personId = person._id;
  if (data.notes && existing.internalNotes !== data.notes) setUpdates.internalNotes = data.notes;
  if (existing.isActive !== true) setUpdates.isActive = true;

  if (Object.keys(setUpdates).length) {
    await Student.updateOne({ _id: existing._id }, { $set: setUpdates });
    report.studentsUpdated += 1;
    return Student.findById(existing._id);
  }

  return existing;
}

async function getActiveCycle() {
  return Cycle.findOne({ isActive: true }).sort({ year: -1, startDate: -1 });
}

async function resolveCampus(campusCode, report) {
  const campus = await Campus.findOne({ code: campusCode });
  if (campus) report.campusesResolved += 1;
  return campus;
}

function buildClassroomDisplayName({ grade, section, level }) {
  return `${grade}° ${section} - ${level}`;
}

async function resolveOrCreateClassroom({ campusId, cycleId, grade, section, level }, report) {
  let classroom = await Classroom.findOne({ campusId, cycleId, grade, section, level });
  if (classroom) return classroom;

  try {
    classroom = await Classroom.create({
      campusId,
      cycleId,
      grade,
      section,
      level,
      capacity: 30,
      displayName: buildClassroomDisplayName({ grade, section, level }),
      isActive: true,
      notes: IMPORT_NOTES,
    });
    report.classroomsCreated += 1;
    return classroom;
  } catch (error) {
    if (error?.code === 11000) {
      return Classroom.findOne({ campusId, cycleId, grade, section, level });
    }
    throw error;
  }
}

async function upsertStudentCycle({ studentId, cycleId, campusId, notes }, report) {
  const updateResult = await StudentCycle.updateOne(
    { studentId, cycleId, campusId },
    {
      $setOnInsert: {
        studentId,
        cycleId,
        campusId,
        status: 'ENROLLED',
        enrolledAt: new Date(),
        notes: notes || 'Importación inicial',
      },
      $set: {
        status: 'ENROLLED',
        notes: notes || 'Importación inicial',
      },
    },
    { upsert: true }
  );

  if (updateResult.upsertedCount > 0) report.studentCyclesCreated += 1;
}

async function resolveOrCreateDraftEnrollment({ student, cycleId, campusId }, report) {
  let enrollment = await Enrollment.findOne({
    cycleId,
    campusId,
    status: 'DRAFT',
    studentIds: student._id,
    notes: /importaci[oó]n inicial/i,
  });

  if (enrollment) return enrollment;

  enrollment = await Enrollment.create({
    familyId: student.familyId || undefined,
    cycleId,
    campusId,
    status: 'DRAFT',
    studentIds: [student._id],
    notes: IMPORT_NOTES,
  });
  report.enrollmentsCreated += 1;
  return enrollment;
}

async function upsertEnrollmentStudent({ enrollment, studentId, classroomId, campusCode }, report) {
  const existing = await EnrollmentStudent.findOne({ enrollmentId: enrollment._id, studentId });
  if (existing) {
    const setUpdates = {};
    if (String(existing.classroomId || '') !== String(classroomId)) setUpdates.classroomId = classroomId;
    if (existing.notes !== 'Importación inicial') setUpdates.notes = 'Importación inicial';

    if (Object.keys(setUpdates).length) {
      await EnrollmentStudent.updateOne({ _id: existing._id }, { $set: setUpdates });
    }

    if (!Array.isArray(enrollment.enrollmentStudents) || !enrollment.enrollmentStudents.some((id) => String(id) === String(existing._id))) {
      await Enrollment.updateOne({ _id: enrollment._id }, { $addToSet: { enrollmentStudents: existing._id } });
    }
    return;
  }

  const created = await EnrollmentStudent.create({
    enrollmentId: enrollment._id,
    studentId,
    classroomId,
    previousSchoolType: campusCode,
    pensionMonthlyAmounts: Array(SCHOOL_MONTHS).fill(NO_APLICA_PENSION),
    notes: 'Importación inicial',
  });

  await Enrollment.updateOne({ _id: enrollment._id }, { $addToSet: { enrollmentStudents: created._id } });
  report.enrollmentStudentsCreated += 1;
}

async function run() {
  const args = parseArgs(process.argv);

  if (!args.file) {
    console.error('Uso: node scripts/importStudents.js --file ./data/students_2025.csv');
    process.exit(1);
  }

  const filePath = path.resolve(process.cwd(), args.file);
  if (!fs.existsSync(filePath)) {
    console.error(`Archivo no encontrado: ${filePath}`);
    process.exit(1);
  }

  await connectDB();

  const report = {
    totalRows: 0,
    rowsInvalid: 0,
    errors: 0,
    peopleCreated: 0,
    peopleUpdated: 0,
    studentsCreated: 0,
    studentsUpdated: 0,
    campusesResolved: 0,
    classroomsCreated: 0,
    studentCyclesCreated: 0,
    enrollmentsCreated: 0,
    enrollmentStudentsCreated: 0,
    warnings: 0,
    warningRows: [],
  };

  const successRows = [];
  const errorRows = [];

  try {
    const activeCycle = await getActiveCycle();
    if (!activeCycle) {
      throw new Error('No existe un ciclo activo (Cycle.isActive=true). No se puede continuar con la importación.');
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const rows = parseCSV(content);
    report.totalRows = rows.length;

    for (const row of rows) {
      const mapped = mapRow(row.raw, report, row.rowNumber);
      const parsed = rowSchema.safeParse(mapped);

      if (!parsed.success) {
        report.rowsInvalid += 1;
        errorRows.push({
          rowNumber: row.rowNumber,
          internalCode: mapped.internalCode || null,
          reason: parsed.error.issues.map((issue) => issue.message).join('; '),
        });
        continue;
      }

      const data = parsed.data;

      try {
        const person = await findOrCreatePerson(data, report);
        const campus = await resolveCampus(data.campusCode, report);
        if (!campus) throw new Error(`Campus no encontrado para code=${data.campusCode}`);

        const student = await upsertStudent(data, person, report);
        const classroom = await resolveOrCreateClassroom({
          campusId: campus._id,
          cycleId: activeCycle._id,
          grade: data.grade,
          section: data.section,
          level: data.level,
        }, report);

        await upsertStudentCycle({
          studentId: student._id,
          cycleId: activeCycle._id,
          campusId: campus._id,
          notes: data.notes,
        }, report);

        const enrollment = await resolveOrCreateDraftEnrollment({
          student,
          cycleId: activeCycle._id,
          campusId: campus._id,
        }, report);

        await upsertEnrollmentStudent({
          enrollment,
          studentId: student._id,
          classroomId: classroom._id,
          campusCode: campus.code,
        }, report);

        successRows.push({
          rowNumber: row.rowNumber,
          internalCode: data.internalCode,
          personId: person._id,
          studentId: student._id,
          campusId: campus._id,
          classroomId: classroom._id,
          cycleId: activeCycle._id,
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

    fs.writeFileSync(path.join(logsDir, 'import-students-success.json'), JSON.stringify(successRows, null, 2), 'utf8');
    fs.writeFileSync(path.join(logsDir, 'import-students-errors.json'), JSON.stringify(errorRows, null, 2), 'utf8');
    fs.writeFileSync(path.join(logsDir, 'import-students-warnings.json'), JSON.stringify(report.warningRows, null, 2), 'utf8');

    console.log('===== Import Students Summary =====');
    console.log(`Total filas: ${report.totalRows}`);
    console.log(`Filas inválidas: ${report.rowsInvalid}`);
    console.log(`People creadas: ${report.peopleCreated}`);
    console.log(`People actualizadas: ${report.peopleUpdated}`);
    console.log(`Students creados: ${report.studentsCreated}`);
    console.log(`Students actualizados: ${report.studentsUpdated}`);
    console.log(`Campus resueltos: ${report.campusesResolved}`);
    console.log(`Classrooms creados: ${report.classroomsCreated}`);
    console.log(`StudentCycles creados: ${report.studentCyclesCreated}`);
    console.log(`Enrollments creados: ${report.enrollmentsCreated}`);
    console.log(`EnrollmentStudents creados: ${report.enrollmentStudentsCreated}`);
    console.log(`Warnings: ${report.warnings}`);
    console.log(`Errores de proceso: ${report.errors}`);
    console.log(`Logs: ${logsDir}`);
    console.log('Archivos tocados:');
    console.log(`- ${path.join(logsDir, 'import-students-success.json')}`);
    console.log(`- ${path.join(logsDir, 'import-students-errors.json')}`);
    console.log(`- ${path.join(logsDir, 'import-students-warnings.json')}`);

    process.exit(0);
  } catch (error) {
    console.error('Error ejecutando importStudents:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
}

run();
