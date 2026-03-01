import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { z } from 'zod';

import { connectDB } from '../src/config/db.js';
import { Student } from '../src/models/student.model.js';
import { Person } from '../src/models/person.model.js';
import { Tutor } from '../src/models/tutor.model.js';
import { Family } from '../src/models/family.model.js';

const RELATIONSHIP_DICTIONARY = {
  PADRE: 'Padre',
  MADRE: 'Madre',
  ABUELO: 'Abuelo',
  ABUELA: 'Abuela',
  HERMANO: 'Hermano',
  HERMANA: 'Hermana',
  TIO: 'Tio',
  TIA: 'Tia',
  APODERADO: 'Apoderado',
  OTRO: 'Otro',
};

const rowSchema = z.object({
  studentCod: z.string().trim().optional().or(z.literal('')),
  studentCods: z.string().trim().optional().or(z.literal('')),
  relationship: z.string().trim().min(1, 'relationship es obligatorio'),
  lastNames: z.string().trim().optional().or(z.literal('')),
  names: z.string().trim().optional().or(z.literal('')),
  dni: z.string().trim().optional().or(z.literal('')),
  gender: z.preprocess(
    (value) => String(value || '').trim().toUpperCase(),
    z.enum(['M', 'F'], { message: 'gender inválido (solo M o F)' })
  ),
  phones: z.string().trim().optional().or(z.literal('')),
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

function parseBooleanFlag(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;

  const normalized = value.trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}

function debugLog(enabled, message, payload) {
  if (!enabled) return;

  if (payload === undefined) {
    console.log(`[importTutors:debug] ${message}`);
    return;
  }

  console.log(`[importTutors:debug] ${message}`, payload);
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
  if (['null', 'undefined', 'n/a', 'na', '-'].includes(lowered)) return undefined;

  return normalized;
}

function normalizeSpaces(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizePhones(value) {
  const raw = normalizeSpaces(value);
  if (!raw) return [];

  return raw
    .split(/[\/,|;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/\D/g, ''))
    .filter(Boolean);
}

function formatLastNames(value) {
  return normalizeSpaces(value).toLocaleUpperCase('es-PE');
}

function formatNames(value) {
  return normalizeSpaces(value)
    .toLocaleLowerCase('es-PE')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toLocaleUpperCase('es-PE') + w.slice(1))
    .join(' ');
}

function parseStudentCodes({ studentCod, studentCods }) {
  const merged = [studentCod, studentCods]
    .map((value) => String(value || ''))
    .join('|');

  return [...new Set(
    merged
      .split(/[\/,|;]+/)
      .map((v) => normalizeSpaces(v))
      .filter(Boolean)
  )];
}

function mapRow(rawRow) {
  return {
    studentCod: normalizeSpaces(rawRow.studentcod),
    studentCods: normalizeSpaces(rawRow.studentcods),
    relationship: normalizeSpaces(rawRow.relationship),
    lastNames: normalizeSpaces(rawRow.lastnames),
    names: normalizeSpaces(rawRow.names),
    dni: normalizeDni(rawRow.dni),
    gender: normalizeSpaces(rawRow.gender),
    phones: normalizeSpaces(rawRow.phones),
    notes: normalizeSpaces(rawRow.notes),
  };
}

function normalizeRelationship(input) {
  const original = String(input || '').trim();
  const normalizedKey = original
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

  return RELATIONSHIP_DICTIONARY[normalizedKey] || null;
}

async function buildStudentCache() {
  const students = await Student.find({}).select('_id internalCode familyId').lean();
  const map = new Map();

  students.forEach((student) => {
    map.set(student.internalCode, student);
  });

  return map;
}

async function resolveTutorPerson(data, normalizedPhones, personByDniCache, report) {
  const formattedNames = formatNames(data.names);
  const formattedLastNames = formatLastNames(data.lastNames);

  let person = null;
  if (data.dni) {
    const cached = personByDniCache.get(data.dni);
    if (cached) person = cached;
    else {
      person = await Person.findOne({ dni: data.dni });
      if (person) personByDniCache.set(data.dni, person);
    }
  }

  if (!person && !data.dni && formattedNames && formattedLastNames) {
    const candidates = await Person.find({ names: formattedNames, lastNames: formattedLastNames }).limit(2);
    if (candidates.length === 1) person = candidates[0];
  }

  const phone = normalizedPhones[0];
  const additionalPhones = normalizedPhones.slice(1);
  const additionalPhonesNote = additionalPhones.length ? `Teléfonos adicionales: ${additionalPhones.join(', ')}` : '';

  if (!person) {
    if (!formattedNames || !formattedLastNames) {
      throw new Error('No se puede crear Person del tutor: faltan names/lastNames y no existe dni previo');
    }

    try {
      person = await Person.create({
        names: formattedNames,
        lastNames: formattedLastNames,
        ...(data.dni ? { dni: data.dni } : {}),
        gender: data.gender,
        ...(phone ? { phone } : {}),
        ...(additionalPhonesNote ? { notes: additionalPhonesNote } : {}),
      });
      report.peopleCreated += 1;
    } catch (error) {
      if (error?.code === 11000 && data.dni) {
        person = await Person.findOne({ dni: data.dni });
      } else {
        throw error;
      }
    }

    if (person && data.dni) personByDniCache.set(data.dni, person);
    return person;
  }

  const setUpdates = {};
  if (formattedNames && person.names !== formattedNames) setUpdates.names = formattedNames;
  if (formattedLastNames && person.lastNames !== formattedLastNames) setUpdates.lastNames = formattedLastNames;
  if (data.dni && person.dni !== data.dni) setUpdates.dni = data.dni;
  if (person.gender !== data.gender) setUpdates.gender = data.gender;
  if (phone && person.phone !== phone) setUpdates.phone = phone;
  if (additionalPhonesNote && !(person.notes || '').includes(additionalPhonesNote)) {
    setUpdates.notes = person.notes ? `${person.notes} | ${additionalPhonesNote}` : additionalPhonesNote;
  }

  if (Object.keys(setUpdates).length) {
    await Person.updateOne({ _id: person._id }, { $set: setUpdates });
    report.peopleUpdated += 1;
    person = await Person.findById(person._id);
  }

  if (person?.dni) personByDniCache.set(person.dni, person);
  return person;
}

async function ensureFamilyForStudent(student, familyByStudentCache, report) {
  const cached = familyByStudentCache.get(String(student._id));
  if (cached) return cached;

  let family = null;
  if (student.familyId) {
    family = await Family.findById(student.familyId);
  }

  if (!family) {
    family = await Family.create({
      tutorIds: [],
      studentIds: [student._id],
      notes: 'Creada por importación de tutores',
    });

    await Student.updateOne({ _id: student._id }, { $set: { familyId: family._id } });
    report.familiesCreated += 1;
    report.studentsLinkedToFamily += 1;

    student.familyId = family._id;
  } else {
    await Family.updateOne({ _id: family._id }, { $addToSet: { studentIds: student._id } });
  }

  familyByStudentCache.set(String(student._id), family);
  return family;
}

async function mergeFamiliesIfNeeded(familyA, familyB, familyByStudentCache, report) {
  if (!familyA || !familyB) return familyA || familyB;
  if (String(familyA._id) === String(familyB._id)) return familyA;

  const mergeEnabled = String(process.env.MERGE_FAMILIES || '').toLowerCase() === 'true';
  if (!mergeEnabled) return familyA;

  const destination = familyA.createdAt && familyB.createdAt && familyA.createdAt > familyB.createdAt ? familyB : familyA;
  const source = String(destination._id) === String(familyA._id) ? familyB : familyA;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const sourceFamily = await Family.findById(source._id).session(session);
    if (!sourceFamily) {
      await session.commitTransaction();
      return destination;
    }

    await Family.updateOne(
      { _id: destination._id },
      {
        $addToSet: {
          studentIds: { $each: sourceFamily.studentIds || [] },
          tutorIds: { $each: sourceFamily.tutorIds || [] },
        },
      },
      { session }
    );

    await Student.updateMany(
      { _id: { $in: sourceFamily.studentIds || [] } },
      { $set: { familyId: destination._id } },
      { session }
    );

    await Family.deleteOne({ _id: source._id }, { session });

    await session.commitTransaction();

    (sourceFamily.studentIds || []).forEach((studentId) => {
      familyByStudentCache.set(String(studentId), destination);
    });

    report.familiesMerged += 1;
    return destination;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

async function upsertTutorForStudent({ student, person, relationship, notes }, report) {
  let tutor = await Tutor.findOne({ studentId: student._id, tutorPersonId: person._id });

  const existingPrimary = await Tutor.findOne({ studentId: student._id, isPrimary: true });
  const preferredPrimary = ['Madre', 'Padre'].includes(relationship);
  const shouldBePrimary = !existingPrimary || preferredPrimary;

  if (!tutor) {
    tutor = await Tutor.create({
      studentId: student._id,
      tutorPersonId: person._id,
      relationship,
      isPrimary: shouldBePrimary,
      livesWithStudent: true,
      ...(notes ? { notes } : {}),
    });
    report.tutorsCreated += 1;
  } else {
    const setUpdates = {};
    if (tutor.relationship !== relationship) setUpdates.relationship = relationship;
    if (tutor.livesWithStudent !== true) setUpdates.livesWithStudent = true;
    if (notes && tutor.notes !== notes) setUpdates.notes = notes;
    if (shouldBePrimary && tutor.isPrimary !== true) setUpdates.isPrimary = true;

    if (Object.keys(setUpdates).length) {
      await Tutor.updateOne({ _id: tutor._id }, { $set: setUpdates });
      report.tutorsUpdated += 1;
      tutor = await Tutor.findById(tutor._id);
    }
  }

  if (shouldBePrimary) {
    await Tutor.updateMany(
      { studentId: student._id, _id: { $ne: tutor._id }, isPrimary: true },
      { $set: { isPrimary: false } }
    );
  }

  return tutor;
}

async function run() {
  const args = parseArgs(process.argv);
  const debug = parseBooleanFlag(args.debug);
  const quiet = parseBooleanFlag(args.quiet);

  if (!args.file) {
    console.error('Uso: node scripts/importTutors.js --file ./data/parents.csv');
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
    skipped: 0,
    errors: 0,
    peopleCreated: 0,
    peopleUpdated: 0,
    tutorsCreated: 0,
    tutorsUpdated: 0,
    familiesCreated: 0,
    familiesMerged: 0,
    studentsLinkedToFamily: 0,
    missingStudents: 0,
  };

  const successRows = [];
  const errorRows = [];
  const skippedRows = [];

  const studentByCodeCache = await buildStudentCache();
  const personByDniCache = new Map();
  const familyByStudentCache = new Map();

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const rows = parseCSV(content);
    report.totalRows = rows.length;
    const progress = createProgressTracker({ scriptName: 'importTutors', total: rows.length, quiet });
    let processed = 0;
    let ok = 0;
    let invalid = 0;
    let errors = 0;

    for (const row of rows) {
      const mapped = mapRow(row.raw);
      debugLog(debug, 'Procesando fila', { rowNumber: row.rowNumber, studentCod: mapped.studentCod, studentCods: mapped.studentCods });
      const parsed = rowSchema.safeParse(mapped);

      if (!parsed.success) {
        report.rowsInvalid += 1;
        invalid += 1;
        processed += 1;
        errorRows.push({
          rowNumber: row.rowNumber,
          studentCod: mapped.studentCod || null,
          reason: parsed.error.issues.map((issue) => issue.message).join('; '),
        });
        progress.render({ processed, ok, invalid, errors });
        continue;
      }

      const data = parsed.data;
      const studentCodes = parseStudentCodes(data);

      if (!studentCodes.length) {
        report.skipped += 1;
        skippedRows.push({
          rowNumber: row.rowNumber,
          reason: 'No hay studentCod/studentCods válidos en la fila',
        });
        continue;
      }

      if (!((data.names && data.lastNames) || data.dni)) {
        report.skipped += 1;
        skippedRows.push({
          rowNumber: row.rowNumber,
          studentCod: studentCodes.join(','),
          reason: 'Faltan datos del tutor (names+lastNames o dni)',
        });
        continue;
      }

      const relationship = normalizeRelationship(data.relationship);
      if (!relationship) {
        report.skipped += 1;
        skippedRows.push({
          rowNumber: row.rowNumber,
          studentCod: studentCodes.join(','),
          reason: `relationship no permitido: ${data.relationship}`,
        });
        continue;
      }

      try {
        const students = studentCodes
          .map((code) => studentByCodeCache.get(code))
          .filter(Boolean)
          .map((student) => ({ ...student }));

        const missingCodes = studentCodes.filter((code) => !studentByCodeCache.has(code));
        if (missingCodes.length) {
          report.missingStudents += missingCodes.length;
          skippedRows.push({
            rowNumber: row.rowNumber,
            studentCod: missingCodes.join(','),
            reason: 'No existe Student para studentCod',
          });
        }

        if (!students.length) {
          report.skipped += 1;
          continue;
        }

        const normalizedPhones = normalizePhones(data.phones);
        const person = await resolveTutorPerson(data, normalizedPhones, personByDniCache, report);

        let baseFamily = null;

        for (const student of students) {
          const family = await ensureFamilyForStudent(student, familyByStudentCache, report);
          if (!baseFamily) baseFamily = family;
          else baseFamily = await mergeFamiliesIfNeeded(baseFamily, family, familyByStudentCache, report);

          const tutor = await upsertTutorForStudent({
            student,
            person,
            relationship,
            notes: data.notes,
          }, report);

          await Family.updateOne(
            { _id: baseFamily._id },
            {
              $addToSet: {
                studentIds: student._id,
                tutorIds: tutor._id,
              },
            }
          );

          await Student.updateOne({ _id: student._id }, { $set: { familyId: baseFamily._id } });
          student.familyId = baseFamily._id;
          studentByCodeCache.set(student.internalCode, student);
          familyByStudentCache.set(String(student._id), baseFamily);

          successRows.push({
            rowNumber: row.rowNumber,
            studentCod: student.internalCode,
            studentId: student._id,
            tutorPersonId: person._id,
            relationship,
            familyId: baseFamily._id,
          });
        }

        ok += 1;
      } catch (error) {
        report.errors += 1;
        errors += 1;
        errorRows.push({
          rowNumber: row.rowNumber,
          studentCod: studentCodes.join(',') || null,
          reason: error.message,
        });
      }

      processed += 1;
      progress.render({ processed, ok, invalid, errors });
    }

    progress.render({ processed, ok, invalid, errors, force: true });
    progress.finish();

    const logsDir = path.resolve(process.cwd(), 'logs');
    fs.mkdirSync(logsDir, { recursive: true });

    fs.writeFileSync(path.join(logsDir, 'import-tutors-success.json'), JSON.stringify(successRows, null, 2), 'utf8');
    fs.writeFileSync(path.join(logsDir, 'import-tutors-errors.json'), JSON.stringify(errorRows, null, 2), 'utf8');
    fs.writeFileSync(path.join(logsDir, 'import-tutors-skipped.json'), JSON.stringify(skippedRows, null, 2), 'utf8');

    const studentsWithoutFamily = await Student.countDocuments({
      $or: [{ familyId: { $exists: false } }, { familyId: null }],
    });

    console.log('===== Import Tutors Summary =====');
    console.log(`Total filas: ${report.totalRows}`);
    console.log(`Filas inválidas: ${report.rowsInvalid}`);
    console.log(`Omitidos: ${report.skipped}`);
    console.log(`Errores de proceso: ${report.errors}`);
    console.log(`People creadas: ${report.peopleCreated}`);
    console.log(`People actualizadas: ${report.peopleUpdated}`);
    console.log(`Tutores creados: ${report.tutorsCreated}`);
    console.log(`Tutores actualizados: ${report.tutorsUpdated}`);
    console.log(`Familias creadas: ${report.familiesCreated}`);
    console.log(`Familias mergeadas: ${report.familiesMerged}`);
    console.log(`Estudiantes vinculados a familia: ${report.studentsLinkedToFamily}`);
    console.log(`StudentCod sin alumno: ${report.missingStudents}`);
    console.log(`Students sin familyId (validación opcional): ${studentsWithoutFamily}`);
    console.log(`MERGE_FAMILIES=${String(process.env.MERGE_FAMILIES || 'false')}`);
    console.log(`Logs: ${logsDir}`);

    process.exit(0);
  } catch (error) {
    console.error('Error ejecutando importTutors:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
}

run();
