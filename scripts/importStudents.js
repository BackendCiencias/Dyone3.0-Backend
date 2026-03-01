import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { z } from 'zod';

import { connectDB } from '../src/config/db.js';
import { Person } from '../src/models/person.model.js';
import { Student } from '../src/models/student.model.js';

const genderSchema = z.enum(['M', 'F']).or(z.enum(['m', 'f'])).transform((value) => value.toUpperCase());

const rowSchema = z.object({
  internalCode: z.string().trim().min(1, 'Código interno es obligatorio'),
  lastNames: z.string().trim().min(1, 'Apellidos es obligatorio'),
  names: z.string().trim().min(1, 'Nombres es obligatorio'),
  dni: z.string().trim().optional().or(z.literal('')),
  gender: genderSchema,
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

function mapRow(rawRow) {
  return {
    internalCode: normalizeSpaces(rawRow.internalcode),
    lastNames: normalizeSpaces(rawRow.apellidos),
    names: normalizeSpaces(rawRow.nombres),
    dni: normalizeDni(rawRow.dni),
    gender: normalizeSpaces(rawRow.genero),
    notes: normalizeSpaces(rawRow.notas),
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
    await Student.create({
      personId: person._id,
      internalCode: data.internalCode,
      ...(data.notes ? { internalNotes: data.notes } : {}),
    });
    report.studentsCreated += 1;
    return;
  }

  const setUpdates = {};
  if (String(existing.personId) !== String(person._id)) setUpdates.personId = person._id;
  if (data.notes && existing.internalNotes !== data.notes) setUpdates.internalNotes = data.notes;

  if (Object.keys(setUpdates).length) {
    await Student.updateOne({ _id: existing._id }, { $set: setUpdates });
    report.studentsUpdated += 1;
  }
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
        await upsertStudent(data, person, report);

        successRows.push({
          rowNumber: row.rowNumber,
          internalCode: data.internalCode,
          personId: person._id,
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

    console.log('===== Import Students Summary =====');
    console.log(`Total filas: ${report.totalRows}`);
    console.log(`Filas inválidas: ${report.rowsInvalid}`);
    console.log(`People creadas: ${report.peopleCreated}`);
    console.log(`People actualizadas: ${report.peopleUpdated}`);
    console.log(`Students creados: ${report.studentsCreated}`);
    console.log(`Students actualizados: ${report.studentsUpdated}`);
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
