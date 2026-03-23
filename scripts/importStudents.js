import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { z } from 'zod';

import { connectDB } from '../src/config/db.js';
import { Person } from '../src/models/person.model.js';
import { Student } from '../src/models/student.model.js';
import { Counter } from '../src/models/counter.model.js';
import { Cycle } from '../src/models/cycle.model.js';
import { Campus } from '../src/models/campus.model.js';
import { Classroom } from '../src/models/classroom.model.js';
import { Vacancy } from '../src/models/vacancy.model.js';
import { Enrollment } from '../src/models/enrollment.model.js';
import { EnrollmentStudent, NO_APLICA_PENSION } from '../src/models/enrollmentStudent.model.js';

const genderSchema = z.enum(['M', 'F']).or(z.enum(['m', 'f'])).transform((value) => value.toUpperCase());
const levelSchema = z.enum(['INITIAL', 'PRIMARY', 'SECONDARY']);
const IMPORT_NOTES = 'Creado por importacion inicial';
const DEFAULT_FILE = './data/students_2025.csv';
const ALLOWED_CAMPUSES = ['CIENCIAS', 'CIENCIAS_APLICADAS', 'CIMAS'];
const OTHER_SCHOOL_NAME = 'Colegio Desconocido';

const rowSchema = z.object({
  internalCode: z.string().trim().min(1, 'Codigo interno es obligatorio'),
  lastNames: z.string().trim().min(1, 'Apellidos es obligatorio'),
  names: z.string().trim().min(1, 'Nombres es obligatorio'),
  dni: z.string().trim().optional().or(z.literal('')),
  gender: genderSchema,
  campusCode: z.enum(['CIENCIAS', 'CIENCIAS_APLICADAS', 'CIMAS']),
  grade: z.string().trim().min(1, 'Grado es obligatorio'),
  section: z.string().trim().min(1, 'Seccion es obligatorio'),
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
    if (!value || value.startsWith('--')) args[key] = true;
    else {
      args[key] = value;
      i += 1;
    }
  }
  return args;
}

function parseBooleanFlag(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'y', 'on'].includes(value.trim().toLowerCase());
}

function formatDurationMs(ms) {
  const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function createProgressTracker({ scriptName, total, quiet }) {
  const startedAt = Date.now();
  const step = Math.max(25, Math.floor((total || 0) / 200));
  let lastLineLength = 0;
  let hasRendered = false;

  if (!quiet) {
    console.log(`Script: ${scriptName}`);
    console.log(`Total filas a procesar: ${total}`);
  }

  return {
    render({ processed, ok, invalid, errors, force = false }) {
      if (quiet || total <= 0) return;
      if (!force && processed !== total && (step <= 0 || processed % step !== 0)) return;
      const elapsedMs = Date.now() - startedAt;
      const percent = Math.floor((processed / total) * 100);
      const avgPerRowMs = processed > 0 ? elapsedMs / processed : 0;
      const etaMs = processed > 0 ? Math.max(0, (total - processed) * avgPerRowMs) : 0;
      const line = `\r${percent}% (${processed}/${total}) | ok:${ok} invalid:${invalid} errors:${errors} | elapsed:${formatDurationMs(elapsedMs)} ETA:${formatDurationMs(etaMs)}`;
      const padding = Math.max(0, lastLineLength - line.length);
      process.stdout.write(line + ' '.repeat(padding));
      lastLineLength = line.length;
      hasRendered = true;
    },
    finish() {
      if (!quiet && hasRendered) console.log('');
    },
  };
}

function maybeFixMojibake(value) {
  const text = String(value || '');
  if (!text) return { value: text, fixed: false };
  const hasMojibake = /Ã|Â|�/.test(text);
  if (!hasMojibake) return { value: text, fixed: false };
  const converted = Buffer.from(text, 'latin1').toString('utf8');
  const badness = (input) => (String(input).match(/Ã|Â|�/g) || []).length;
  if (badness(converted) < badness(text)) return { value: converted, fixed: true };
  return { value: text, fixed: false };
}

function normalizeHeader(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function splitLine(line, delimiter) {
  return line.split(delimiter).map((v) => maybeFixMojibake(v).value.trim());
}

function parseCSV(content) {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
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
    headers.forEach((header, i) => { raw[header] = values[i] || ''; });
    return { rowNumber: index + 2, raw };
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

function extractStudentCodeSequence(input) {
  const normalized = normalizeSpaces(input).toUpperCase();
  const match = normalized.match(/^COD(?:_A)?(\d+)$/);
  if (!match) return null;
  const seq = Number(match[1]);
  return Number.isFinite(seq) ? seq : null;
}

async function syncStudentInternalCodeCounter(report) {
  const students = await Student.find({}).select('internalCode').lean();
  let maxSeq = 0;
  for (const student of students) {
    const seq = extractStudentCodeSequence(student.internalCode);
    if (seq && seq > maxSeq) maxSeq = seq;
  }
  await Counter.findOneAndUpdate(
    { key: 'student_internal_code' },
    { $set: { seq: maxSeq } },
    { upsert: true, new: true }
  );
  report.counterSyncedTo = maxSeq;
}

function mapRow(rawRow, report, rowNumber) {
  const rawNotes = getByAliases(rawRow, ['notas', 'observaciones', 'informacion']);
  const fixedNotes = maybeFixMojibake(rawNotes);
  if (/Ã|Â|�/.test(rawNotes) && !fixedNotes.fixed) {
    report.warnings += 1;
    report.warningRows.push({ rowNumber, reason: 'No se pudo corregir posible mojibake en notas; se guarda valor original' });
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
  if (data.dni) person = await Person.findOne({ dni: data.dni });
  if (!person) {
    const candidates = await Person.find({ names: normalizedNames, lastNames: normalizedLastNames }).limit(2);
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
  const previousCampus = data.campusCode;
  if (!existing) {
    const created = await Student.create({
      personId: person._id,
      internalCode: data.internalCode,
      previousCampus,
      activeStatus: 'ACTIVE',
      ...(data.notes ? { internalNotes: data.notes } : {}),
    });
    report.studentsCreated += 1;
    return created;
  }

  const setUpdates = {};
  if (String(existing.personId) !== String(person._id)) setUpdates.personId = person._id;
  if (data.notes && existing.internalNotes !== data.notes) setUpdates.internalNotes = data.notes;
  if (existing.previousCampus !== previousCampus) setUpdates.previousCampus = previousCampus;
  if (existing.activeStatus !== 'ACTIVE') setUpdates.activeStatus = 'ACTIVE';

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

async function resolveExistingClassroom({ campusId, cycleId, grade, section, level }) {
  return Classroom.findOne({ campusId, cycleId, grade, section, level });
}

async function upsertVacancy({ studentId, cycleId, classroomId, notes }, report) {
  const existing = await Vacancy.findOne({ studentId, cycleId });
  if (!existing) {
    await Vacancy.create({ studentId, cycleId, classroomId, notes: notes || IMPORT_NOTES });
    report.vacanciesCreated += 1;
    return;
  }
  const setUpdates = {};
  if (String(existing.classroomId) !== String(classroomId)) setUpdates.classroomId = classroomId;
  if ((notes || IMPORT_NOTES) !== existing.notes) setUpdates.notes = notes || IMPORT_NOTES;
  if (Object.keys(setUpdates).length > 0) {
    await Vacancy.updateOne({ _id: existing._id }, { $set: setUpdates });
    report.vacanciesUpdated += 1;
  }
}

function derivePreviousSchoolType(previousCampus) {
  const normalized = normalizeCampusCode(previousCampus);
  return ALLOWED_CAMPUSES.includes(normalized) ? normalized : 'OTHER';
}

async function findEnrollmentStudentForCycle(studentId, cycleId) {
  const rows = await EnrollmentStudent.find({ studentId })
    .populate({ path: 'enrollmentId', select: '_id cycleId status campusId enrollmentStudents notes' });

  return rows.find((row) => String(row?.enrollmentId?.cycleId) === String(cycleId)) || null;
}

async function upsertDraftEnrollmentForStudent({ student, classroom, cycleId, campusId, notes }, report) {
  const existingEnrollmentStudent = await findEnrollmentStudentForCycle(student._id, cycleId);

  const previousSchoolType = derivePreviousSchoolType(student.previousCampus);
  const enrollmentStudentPayload = {
    classroomId: classroom._id,
    previousSchoolType,
    ...(previousSchoolType === 'OTHER' ? { previousSchoolName: OTHER_SCHOOL_NAME } : {}),
    admissionFee: { applies: false, amount: 0, isExempt: false, reason: '' },
    enrollmentFee: { amount: 0, isExempt: false, reason: '' },
    pensionMonthlyAmounts: Array(10).fill(NO_APLICA_PENSION),
    notes: notes || undefined,
  };

  if (existingEnrollmentStudent?.enrollmentId) {
    const enrollment = existingEnrollmentStudent.enrollmentId;
    const currentStatus = String(enrollment.status || '').toUpperCase();
    const setUpdates = {
      campusId,
      ...(notes ? { notes } : {}),
    };

    if (!['ENROLLED', 'TRANSFERRED'].includes(currentStatus)) {
      setUpdates.status = 'ABSENT';
    } else {
      report.enrollmentStatusesPreserved += 1;
    }

    await Enrollment.updateOne(
      { _id: enrollment._id },
      {
        $set: setUpdates,
        $addToSet: {
          enrollmentStudents: existingEnrollmentStudent._id,
        },
      }
    );

    await EnrollmentStudent.updateOne(
      { _id: existingEnrollmentStudent._id },
      { $set: enrollmentStudentPayload }
    );

    report.enrollmentsUpdated += 1;
    report.enrollmentStudentsUpdated += 1;
    return enrollment._id;
  }

  const enrollment = await Enrollment.create({
    cycleId,
    campusId,
    status: 'ABSENT',
    ...(notes ? { notes } : {}),
  });

  const enrollmentStudent = await EnrollmentStudent.create({
    enrollmentId: enrollment._id,
    studentId: student._id,
    ...enrollmentStudentPayload,
  });

  await Enrollment.updateOne(
    { _id: enrollment._id },
    {
      $set: {
        enrollmentStudents: [enrollmentStudent._id],
      },
    }
  );

  report.enrollmentsCreated += 1;
  report.enrollmentStudentsCreated += 1;
  return enrollment._id;
}

async function run() {
  const args = parseArgs(process.argv);
  const quiet = parseBooleanFlag(args.quiet);
  const selectedFile = String(args.file || DEFAULT_FILE);
  const filePath = path.resolve(process.cwd(), selectedFile);
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
    enrollmentsCreated: 0,
    enrollmentsUpdated: 0,
    enrollmentStudentsCreated: 0,
    enrollmentStudentsUpdated: 0,
    enrollmentStatusesPreserved: 0,
    vacanciesCreated: 0,
    vacanciesUpdated: 0,
    counterSyncedTo: 0,
    warnings: 0,
    warningRows: [],
  };

  const successRows = [];
  const errorRows = [];

  try {
    const activeCycle = await getActiveCycle();
    if (!activeCycle) throw new Error('No existe un ciclo activo (Cycle.isActive=true). No se puede continuar con la importacion.');

    if (!quiet) {
      console.log(`Archivo origen: ${selectedFile}`);
      console.log('Campus aplicado: segun CSV');
    }

    const rows = parseCSV(fs.readFileSync(filePath, 'utf8'));
    report.totalRows = rows.length;
    const progress = createProgressTracker({ scriptName: 'importStudents', total: rows.length, quiet });
    let processed = 0;
    let ok = 0;
    let invalid = 0;
    let errors = 0;

    for (const row of rows) {
      const mapped = mapRow(row.raw, report, row.rowNumber);
      const parsed = rowSchema.safeParse(mapped);

      if (!parsed.success) {
        report.rowsInvalid += 1;
        invalid += 1;
        processed += 1;
        errorRows.push({ rowNumber: row.rowNumber, internalCode: mapped.internalCode || null, reason: parsed.error.issues.map((issue) => issue.message).join('; ') });
        progress.render({ processed, ok, invalid, errors });
        continue;
      }

      const data = parsed.data;

      try {
        if (!ALLOWED_CAMPUSES.includes(data.campusCode)) throw new Error(`Campus invalido en CSV: ${data.campusCode}`);
        const campus = await resolveCampus(data.campusCode, report);
        if (!campus) throw new Error(`Campus no encontrado para code=${data.campusCode}`);

        const classroom = await resolveExistingClassroom({
          campusId: campus._id,
          cycleId: activeCycle._id,
          grade: data.grade,
          section: data.section,
          level: data.level,
        });
        if (!classroom) throw new Error(`Classroom no encontrado para campus=${data.campusCode} level=${data.level} grade=${data.grade} section=${data.section}`);

        const person = await findOrCreatePerson(data, report);
        const student = await upsertStudent(data, person, report);
        const enrollmentId = await upsertDraftEnrollmentForStudent({
          student,
          classroom,
          cycleId: activeCycle._id,
          campusId: campus._id,
          notes: data.notes,
        }, report);

        await upsertVacancy({ studentId: student._id, cycleId: activeCycle._id, classroomId: classroom._id, notes: data.notes }, report);

        successRows.push({ rowNumber: row.rowNumber, internalCode: data.internalCode, personId: person._id, studentId: student._id, campusId: campus._id, classroomId: classroom._id, cycleId: activeCycle._id, enrollmentId });
        ok += 1;
      } catch (error) {
        report.errors += 1;
        errors += 1;
        errorRows.push({ rowNumber: row.rowNumber, internalCode: data.internalCode || null, reason: error.message });
      }

      processed += 1;
      progress.render({ processed, ok, invalid, errors });
    }

    progress.render({ processed, ok, invalid, errors, force: true });
    progress.finish();

    const logsDir = path.resolve(process.cwd(), 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(path.join(logsDir, 'import-students-success.json'), JSON.stringify(successRows, null, 2), 'utf8');
    fs.writeFileSync(path.join(logsDir, 'import-students-errors.json'), JSON.stringify(errorRows, null, 2), 'utf8');
    fs.writeFileSync(path.join(logsDir, 'import-students-warnings.json'), JSON.stringify(report.warningRows, null, 2), 'utf8');
    await syncStudentInternalCodeCounter(report);

    console.log('===== Import Students Summary =====');
    console.log(`Total filas: ${report.totalRows}`);
    console.log(`Filas invalidas: ${report.rowsInvalid}`);
    console.log(`People creadas: ${report.peopleCreated}`);
    console.log(`People actualizadas: ${report.peopleUpdated}`);
    console.log(`Students creados: ${report.studentsCreated}`);
    console.log(`Students actualizados: ${report.studentsUpdated}`);
    console.log(`Campus resueltos: ${report.campusesResolved}`);
    console.log(`Matriculas ausentes creadas: ${report.enrollmentsCreated}`);
    console.log(`Matriculas ausentes actualizadas: ${report.enrollmentsUpdated}`);
    console.log(`Matriculas con estado real preservado: ${report.enrollmentStatusesPreserved}`);
    console.log(`EnrollmentStudents creados: ${report.enrollmentStudentsCreated}`);
    console.log(`EnrollmentStudents actualizados: ${report.enrollmentStudentsUpdated}`);
    console.log(`Vacancies creadas: ${report.vacanciesCreated}`);
    console.log(`Vacancies actualizadas: ${report.vacanciesUpdated}`);
    console.log(`Counter student_internal_code sincronizado a: ${report.counterSyncedTo}`);
    console.log(`Warnings: ${report.warnings}`);
    console.log(`Errores de proceso: ${report.errors}`);
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
