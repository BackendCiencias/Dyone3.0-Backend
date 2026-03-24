import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { Student } from '../src/models/student.model.js';
import { Person } from '../src/models/person.model.js';
import { Vacancy } from '../src/models/vacancy.model.js';
import { Classroom } from '../src/models/classroom.model.js';
import { Cycle } from '../src/models/cycle.model.js';
import { Campus } from '../src/models/campus.model.js';

const DEFAULT_FILE = './data/caja_arequipa.csv';
const ALLOWED_CAMPUSES = ['CIENCIAS', 'CIENCIAS_APLICADAS', 'CIMAS'];

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function normalizeBankCode(value) {
  const digitsOnly = String(value || '').replace(/\D/g, '').trim();
  if (!digitsOnly) return '';
  if (digitsOnly.length >= 10) return digitsOnly;
  return digitsOnly.padStart(10, '0');
}

function parseCsv(content) {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const delimiter = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(delimiter).map((value) => value.trim());
  return lines.slice(1).map((line, index) => {
    const cols = line.split(delimiter);
    const raw = {};
    headers.forEach((header, i) => { raw[header] = cols[i] || ''; });
    return { rowNumber: index + 2, raw };
  });
}

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

function normalizeCampusCode(value) {
  return String(value || '').trim().toUpperCase();
}

function resolveCampusFilter(value) {
  if (!value) return null;

  const normalized = normalizeCampusCode(value);
  if (!ALLOWED_CAMPUSES.includes(normalized)) {
    throw new Error(`Campus inválido para --campus: ${value}. Permitidos: ${ALLOWED_CAMPUSES.join(', ')}`);
  }

  return normalized;
}

async function getActiveCycle() {
  const now = new Date();
  const active = await Cycle.findOne({
    type: 'SCHOOL_YEAR',
    isActive: true,
    startDate: { $lte: now },
    endDate: { $gte: now },
  }).sort({ startDate: -1 }).lean();
  if (active) return active;
  return Cycle.findOne({ type: 'SCHOOL_YEAR', isActive: true }).sort({ startDate: -1 }).lean();
}

function buildCandidateIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    const person = row.studentId?.personId;
    const classroom = row.classroomId;
    if (!person || !classroom?.grade) continue;

    const key = [
      normalizeText(person.lastNames),
      normalizeText((person.names || '').split(/\s+/)[0] || ''),
      normalizeText(classroom.grade),
      normalizeText(row.campusCode || ''),
    ].join('|');
    const fallbackKey = [
      normalizeText(person.lastNames),
      normalizeText((person.names || '').split(/\s+/)[0] || ''),
      normalizeText(classroom.grade),
      '',
    ].join('|');

    if (!index.has(key)) index.set(key, []);
    index.get(key).push({
      studentId: String(row.studentId._id),
      internalCode: row.studentId.internalCode,
      fullName: `${person.lastNames}, ${person.names}`,
      campusCode: row.campusCode || null,
    });
    if (!index.has(fallbackKey)) index.set(fallbackKey, []);
    index.get(fallbackKey).push({
      studentId: String(row.studentId._id),
      internalCode: row.studentId.internalCode,
      fullName: `${person.lastNames}, ${person.names}`,
      campusCode: row.campusCode || null,
    });
  }
  return index;
}

async function run() {
  const args = parseArgs(process.argv);
  const selectedFile = String(args.file || DEFAULT_FILE);
  const campusFilter = resolveCampusFilter(args.campus);
  const filePath = path.resolve(process.cwd(), selectedFile);

  if (!fs.existsSync(filePath)) {
    console.error(`Archivo no encontrado: ${filePath}`);
    process.exit(1);
  }

  await connectDB();

  try {
    const activeCycle = await getActiveCycle();
    if (!activeCycle?._id) throw new Error('No existe un ciclo escolar activo');
    let campusId = null;
    if (campusFilter) {
      const campus = await Campus.findOne({ code: campusFilter }).select('_id code').lean();
      if (!campus?._id) throw new Error(`No existe campus para code=${campusFilter}`);
      campusId = String(campus._id);
    }

    console.log(`Archivo origen: ${selectedFile}`);
    console.log(`Campus aplicado: ${campusFilter || 'todos'}`);

    const vacancies = await Vacancy.find({ cycleId: activeCycle._id })
      .populate({
        path: 'studentId',
        select: '_id internalCode bankCode personId',
        populate: { path: 'personId', model: Person, select: 'names lastNames' },
      })
      .populate('classroomId', '_id grade level campusId')
      .lean();

    const campuses = await Campus.find({}).select('_id code').lean();
    const campusById = new Map(campuses.map((row) => [String(row._id), row.code]));

    const enrichedVacancies = vacancies.map((row) => ({
      ...row,
      campusCode: campusById.get(String(row.classroomId?.campusId || '')) || null,
    }));

    const filteredVacancies = campusId
      ? enrichedVacancies.filter((row) => String(row.classroomId?.campusId || '') === campusId)
      : enrichedVacancies;

    const candidateIndex = buildCandidateIndex(filteredVacancies);
    const rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
    const logsDir = path.resolve(process.cwd(), 'logs');
    fs.mkdirSync(logsDir, { recursive: true });

    const updated = [];
    const notFound = [];
    const ambiguous = [];
    const errors = [];

    for (const row of rows) {
      const bankCode = normalizeBankCode(row.raw['CODIGO CAJA'] || '');
      const lastNames = normalizeText(`${row.raw['APELLIDO PATERNO'] || ''} ${row.raw['APELLIDO MATERNO'] || ''}`);
      const firstName = normalizeText(row.raw['1ER NOMBRE'] || '');
      const grade = normalizeText(row.raw.CLASIFICACION2 || '');
      const campus = normalizeText(normalizeCampusCode(row.raw.CAMPUS || ''));

      if (!bankCode || !lastNames || !firstName || !grade) {
        notFound.push({ rowNumber: row.rowNumber, bankCode, reason: 'Fila incompleta para búsqueda' });
        continue;
      }

      const key = [lastNames, firstName, grade, campus].join('|');
      const fallbackKey = [lastNames, firstName, grade, ''].join('|');
      const matches = candidateIndex.get(key) || (!campus ? candidateIndex.get(fallbackKey) : []) || [];

      if (matches.length === 0) {
        notFound.push({
          rowNumber: row.rowNumber,
          bankCode,
          lastNames,
          firstName,
          grade,
          reason: 'No se encontró alumno por apellidos + primer nombre + grado',
        });
        continue;
      }

      if (matches.length > 1) {
        ambiguous.push({
          rowNumber: row.rowNumber,
          bankCode,
          lastNames,
          firstName,
          grade,
          matches,
        });
        continue;
      }

      const match = matches[0];
      try {
        await Student.updateOne({ _id: match.studentId }, { $set: { bankCode } });
        updated.push({
          rowNumber: row.rowNumber,
          bankCode,
          studentId: match.studentId,
          internalCode: match.internalCode,
          fullName: match.fullName,
        });
      } catch (error) {
        errors.push({
          rowNumber: row.rowNumber,
          bankCode,
          internalCode: match.internalCode,
          reason: error?.code === 11000 ? 'bankCode duplicado en otro estudiante' : error.message,
        });
      }
    }

    fs.writeFileSync(path.join(logsDir, 'import-bank-codes-success.json'), JSON.stringify(updated, null, 2), 'utf8');
    fs.writeFileSync(path.join(logsDir, 'import-bank-codes-not-found.json'), JSON.stringify(notFound, null, 2), 'utf8');
    fs.writeFileSync(path.join(logsDir, 'import-bank-codes-ambiguous.json'), JSON.stringify(ambiguous, null, 2), 'utf8');
    fs.writeFileSync(path.join(logsDir, 'import-bank-codes-errors.json'), JSON.stringify(errors, null, 2), 'utf8');

    console.log('===== Import Bank Codes Summary =====');
    console.log(`Actualizados: ${updated.length}`);
    console.log(`No encontrados: ${notFound.length}`);
    console.log(`Ambiguos: ${ambiguous.length}`);
    console.log(`Errores: ${errors.length}`);
    console.log(`Logs: ${logsDir}`);
    process.exit(0);
  } catch (error) {
    console.error('Error ejecutando importStudentBankCodes:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
}

run();
