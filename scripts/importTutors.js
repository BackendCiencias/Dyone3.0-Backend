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
  studentCod: z.string().trim().min(1, 'studentCod es obligatorio'),
  relationship: z.string().trim().optional().or(z.literal('')),
  lastNames: z.string().trim().optional().or(z.literal('')),
  names: z.string().trim().optional().or(z.literal('')),
  dni: z.string().trim().optional(),
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

function normalizePhones(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];

  return raw
    .split(/[;,\-\s]+/)
    .map((p) => p.replace(/\D/g, '').trim())
    .filter(Boolean);
}

function formatLastNames(value) {
  return String(value || '').trim().toUpperCase();
}

function formatNames(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function mapRow(rawRow) {
  return {
    studentCod: (rawRow.studentcod || '').trim(),
    relationship: (rawRow.relationship || '').trim(),
    lastNames: (rawRow.lastnames || '').trim(),
    names: (rawRow.names || '').trim(),
    dni: normalizeDni(rawRow.dni),
    gender: (rawRow.gender || '').trim(),
    phones: (rawRow.phones || '').trim(),
    notes: (rawRow.notes || '').trim(),
  };
}

function normalizeRelationship(input) {
  const original = String(input || '').trim();
  if (!original) {
    throw new Error('relationship vacío');
  }

  const normalizedKey = original
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

  const mapped = RELATIONSHIP_DICTIONARY[normalizedKey];
  if (!mapped) {
    throw new Error(`relationship no reconocido: ${original}`);
  }

  return mapped;
}

async function resolveTutorPerson(data, normalizedPhones) {
  const formattedNames = formatNames(data.names);
  const formattedLastNames = formatLastNames(data.lastNames);

  let person = null;
  let created = false;
  let updated = false;

  if (data.dni) {
    person = await Person.findOne({ dni: data.dni });
  }

  if (!person && !data.dni && formattedNames && formattedLastNames) {
    const candidates = await Person.find({
      names: formattedNames,
      lastNames: formattedLastNames,
    }).limit(2);

    if (candidates.length === 1) {
      person = candidates[0];
    }
  }

  const phone = normalizedPhones[0];
  const additionalPhones = normalizedPhones.slice(1);
  const additionalPhonesNote = additionalPhones.length
    ? `Teléfonos adicionales: ${additionalPhones.join(', ')}`
    : '';

  if (!person) {
    if (!formattedNames || !formattedLastNames) {
      throw new Error('No se puede crear Person del tutor: faltan nombres/apellidos y no existe dni previo');
    }

    const personNotes = [additionalPhonesNote].filter(Boolean).join(' | ') || undefined;

    person = await Person.create({
      names: formattedNames,
      lastNames: formattedLastNames,
      ...(data.dni ? { dni: data.dni } : {}),
      gender: data.gender,
      ...(phone ? { phone } : {}),
      ...(personNotes ? { notes: personNotes } : {}),
    });

    created = true;
    return { person, created, updated };
  }

  const personSet = {};

  if (formattedNames && person.names !== formattedNames) personSet.names = formattedNames;
  if (formattedLastNames && person.lastNames !== formattedLastNames) personSet.lastNames = formattedLastNames;
  if (data.dni && person.dni !== data.dni) personSet.dni = data.dni;
  if (person.gender !== data.gender) personSet.gender = data.gender;
  if (phone && person.phone !== phone) personSet.phone = phone;

  if (additionalPhonesNote && !(person.notes || '').includes(additionalPhonesNote)) {
    personSet.notes = person.notes ? `${person.notes} | ${additionalPhonesNote}` : additionalPhonesNote;
  }

  if (Object.keys(personSet).length) {
    await Person.updateOne({ _id: person._id }, { $set: personSet });
    updated = true;
  }

  return { person, created, updated };
}


async function findFamilyByTutorPersonId(tutorPersonId) {
  const tutors = await Tutor.find({ tutorPersonId }).select('_id').lean();
  if (!tutors.length) return null;

  return Family.findOne({ tutorIds: { $in: tutors.map((row) => row._id) } });
}

async function linkStudentToFamily(student, family, previousFamilyId = null) {
  await Student.updateOne({ _id: student._id }, { $set: { familyId: family._id } });

  await Family.updateOne(
    { _id: family._id },
    { $addToSet: { studentIds: student._id } }
  );

  if (!previousFamilyId || String(previousFamilyId) === String(family._id)) return;

  await Family.updateOne(
    { _id: previousFamilyId },
    { $pull: { studentIds: student._id } }
  );

  const previousFamily = await Family.findById(previousFamilyId).lean();
  if (previousFamily && (!previousFamily.studentIds || previousFamily.studentIds.length === 0) && (!previousFamily.tutorIds || previousFamily.tutorIds.length === 0)) {
    await Family.deleteOne({ _id: previousFamilyId });
  }
}

async function run() {
  const args = parseArgs(process.argv);

  if (!args.file) {
    console.error('Uso: node scripts/importTutors.js --file ./tutors.csv');
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
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
  };

  const successRows = [];
  const errorRows = [];
  const skippedRows = [];

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
          studentCod: mapped.studentCod || null,
          reason: parsed.error.issues.map((issue) => issue.message).join('; '),
        });
        continue;
      }

      const data = parsed.data;

      if (!((data.names && data.lastNames) || data.dni)) {
        report.skipped += 1;
        skippedRows.push({
          rowNumber: row.rowNumber,
          studentCod: data.studentCod,
          reason: 'Faltan datos del tutor (names+lastNames o dni)',
        });
        continue;
      }

      try {
        const relationship = normalizeRelationship(data.relationship);
        const student = await Student.findOne({ internalCode: data.studentCod });
        if (!student) {
          throw new Error('No existe Student para studentCod');
        }

        const normalizedPhones = normalizePhones(data.phones);
        const { person } = await resolveTutorPerson(data, normalizedPhones);

        let tutor = await Tutor.findOne({
          studentId: student._id,
          tutorPersonId: person._id,
        });

        let createdSomething = false;
        let updatedSomething = false;

        if (!tutor) {
          tutor = await Tutor.create({
            studentId: student._id,
            tutorPersonId: person._id,
            relationship,
            isPrimary: true,
            livesWithStudent: true,
            notes: data.notes || undefined,
          });
          createdSomething = true;
        } else {
          const tutorSet = {
            isPrimary: true,
            livesWithStudent: true,
          };

          if (data.notes && tutor.notes !== data.notes) {
            tutorSet.notes = data.notes;
          }

          if (
            tutor.isPrimary !== true ||
            tutor.livesWithStudent !== true ||
            (data.notes && tutor.notes !== data.notes)
          ) {
            await Tutor.updateOne({ _id: tutor._id }, { $set: tutorSet });
            updatedSomething = true;
          }
        }

        await Tutor.updateMany(
          {
            studentId: student._id,
            _id: { $ne: tutor._id },
            isPrimary: true,
          },
          { $set: { isPrimary: false } }
        );

        let targetFamily = null;
        const familyByTutor = await findFamilyByTutorPersonId(person._id);

        if (familyByTutor) {
          targetFamily = familyByTutor;
          if (!student.familyId || String(student.familyId) !== String(familyByTutor._id)) {
            await linkStudentToFamily(student, familyByTutor, student.familyId || null);
            student.familyId = familyByTutor._id;
          }
        } else if (student.familyId) {
          targetFamily = await Family.findById(student.familyId);
        }

        if (!targetFamily) {
          targetFamily = await Family.create({
            tutorIds: [],
            studentIds: [student._id],
            notes: 'Creado automáticamente por importación inicial.',
          });
          await Student.updateOne({ _id: student._id }, { $set: { familyId: targetFamily._id } });
          student.familyId = targetFamily._id;
        }

        await Family.updateOne(
          { _id: targetFamily._id },
          { $addToSet: { tutorIds: tutor._id, studentIds: student._id } }
        );

        if (createdSomething) report.created += 1;
        else if (updatedSomething) report.updated += 1;

        successRows.push({
          rowNumber: row.rowNumber,
          studentCod: data.studentCod,
          studentId: student._id,
          tutorPersonId: person._id,
          relationship,
          isPrimary: true,
        });
      } catch (error) {
        report.errors += 1;
        errorRows.push({
          rowNumber: row.rowNumber,
          studentCod: data.studentCod || null,
          reason: error.message,
        });
      }
    }

    const logsDir = path.resolve(process.cwd(), 'logs');
    fs.mkdirSync(logsDir, { recursive: true });

    fs.writeFileSync(
      path.join(logsDir, 'import-tutors-success.json'),
      JSON.stringify(successRows, null, 2),
      'utf8'
    );

    fs.writeFileSync(
      path.join(logsDir, 'import-tutors-errors.json'),
      JSON.stringify(errorRows, null, 2),
      'utf8'
    );

    fs.writeFileSync(
      path.join(logsDir, 'import-tutors-skipped.json'),
      JSON.stringify(skippedRows, null, 2),
      'utf8'
    );

    console.log('===== Import Tutors Summary =====');
    console.log(`Total filas: ${report.totalRows}`);
    console.log(`Creados: ${report.created}`);
    console.log(`Actualizados: ${report.updated}`);
    console.log(`Omitidos: ${report.skipped}`);
    console.log(`Errores: ${report.errors}`);
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
