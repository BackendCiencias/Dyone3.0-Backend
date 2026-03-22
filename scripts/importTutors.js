import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { z } from 'zod';
import { connectDB } from '../src/config/db.js';
import { Student } from '../src/models/student.model.js';
import { Person } from '../src/models/person.model.js';
import { Tutor } from '../src/models/tutor.model.js';
import { Enrollment } from '../src/models/enrollment.model.js';
import { EnrollmentStudent, NO_APLICA_PENSION } from '../src/models/enrollmentStudent.model.js';
import { Vacancy } from '../src/models/vacancy.model.js';
import { BillingSchedule } from '../src/models/billingSchedule.model.js';
import { Charge } from '../src/models/charge.model.js';
import { Cycle } from '../src/models/cycle.model.js';
import { resolveBillingConceptsByCode, upsertStudentCycleForEnrollment } from '../src/modules/enrollments/services/enrollmentConfirmation.helpers.js';

const REL = { PADRE: 'Padre', MADRE: 'Madre', ABUELO: 'Abuelo', ABUELA: 'Abuela', HERMANO: 'Hermano', HERMANA: 'Hermana', TIO: 'Tío', TIA: 'Tía', APODERADO: 'Apoderado', OTRO: 'Otro' };
const ENROLL_NOTES = 'Matricula creada por importacion masiva de tutores';
const EXEMPTION_REASON = 'Exonerado por secretaria, pendiente de revision';
const OTHER_SCHOOL_NAME = 'Colegio Desconocido';
const SCHOOL_MONTHS = 10;
const DEFAULT_FILE = './data/parents.csv';
const ALLOWED_CAMPUSES = ['CIENCIAS', 'CIENCIAS_APLICADAS', 'CIMAS'];

const rowSchema = z.object({
  studentCod: z.string().trim().optional().or(z.literal('')),
  studentCods: z.string().trim().optional().or(z.literal('')),
  relationship: z.string().trim().optional().or(z.literal('')),
  lastNames: z.string().trim().optional().or(z.literal('')),
  names: z.string().trim().optional().or(z.literal('')),
  dni: z.string().trim().optional().or(z.literal('')),
  gender: z.string().trim().optional().or(z.literal('')),
  phones: z.string().trim().optional().or(z.literal('')),
  notes: z.string().trim().optional().or(z.literal('')),
  admissionFee: z.string().trim().optional().or(z.literal('')),
  enrollmentFee: z.string().trim().optional().or(z.literal('')),
  tuition: z.string().trim().optional().or(z.literal('')),
});

function parseArgs(argv) { const args = {}; for (let i = 2; i < argv.length; i += 1) { const k = argv[i]; if (!k.startsWith('--')) continue; const key = k.slice(2); const v = argv[i + 1]; if (!v || v.startsWith('--')) args[key] = true; else { args[key] = v; i += 1; } } return args; }
function parseBooleanFlag(v) { if (typeof v === 'boolean') return v; if (typeof v !== 'string') return false; return ['1', 'true', 'yes', 'y', 'on'].includes(v.trim().toLowerCase()); }
function formatDurationMs(ms) { const s = Math.floor(Math.max(0, ms || 0) / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
function createProgressTracker({ scriptName, total, quiet }) { const startedAt = Date.now(); const step = Math.max(25, Math.floor((total || 0) / 200)); let last = 0; let rendered = false; if (!quiet) { console.log(`Script: ${scriptName}`); console.log(`Total filas a procesar: ${total}`); } return { render({ processed, ok, invalid, errors, force = false }) { if (quiet || total <= 0) return; if (!force && processed !== total && processed % step !== 0) return; const elapsed = Date.now() - startedAt; const pct = Math.floor((processed / total) * 100); const avg = processed > 0 ? elapsed / processed : 0; const eta = processed > 0 ? Math.max(0, (total - processed) * avg) : 0; const line = `\r${pct}% (${processed}/${total}) | ok:${ok} invalid:${invalid} errors:${errors} | elapsed:${formatDurationMs(elapsed)} ETA:${formatDurationMs(eta)}`; process.stdout.write(line + ' '.repeat(Math.max(0, last - line.length))); last = line.length; rendered = true; }, finish() { if (!quiet && rendered) console.log(''); } }; }
function normalizeHeader(v) { return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
function splitLine(line, d) { return line.split(d).map((v) => v.trim()); }
function parseCSV(content) { const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean); if (!lines.length) return []; const h = lines[0]; const count = (s, ch) => (s.match(new RegExp(`\\${ch}`, 'g')) || []).length; const tab = count(h, '\t'); const comma = count(h, ','); const semi = count(h, ';'); let d = ','; const max = Math.max(tab, comma, semi); if (max === tab) d = '\t'; else if (max === semi) d = ';'; const headers = splitLine(h, d).map(normalizeHeader); return lines.slice(1).map((line, index) => { const values = splitLine(line, d); const raw = {}; headers.forEach((header, i) => { raw[header] = values[i] || ''; }); return { rowNumber: index + 2, raw }; }); }
function normalizeDni(v) { const n = String(v || '').trim(); if (!n) return undefined; return ['null', 'undefined', 'n/a', 'na', '-'].includes(n.toLowerCase()) ? undefined : n; }
function normalizeSpaces(v) { return String(v || '').trim().replace(/\s+/g, ' '); }
function normalizeCampusCode(v) { return normalizeSpaces(v).toLocaleUpperCase('es-PE'); }
function resolveCampusFilter(v) { if (!v) return null; const normalized = normalizeCampusCode(v); if (!ALLOWED_CAMPUSES.includes(normalized)) throw new Error(`Campus invalido para --campus: ${v}. Permitidos: ${ALLOWED_CAMPUSES.join(', ')}`); return normalized; }
function normalizePhones(v) { return normalizeSpaces(v).split(/[\/,|;]+/).map((x) => x.trim()).filter(Boolean).map((x) => x.replace(/\D/g, '')).filter(Boolean); }
function formatLastNames(v) { return normalizeSpaces(v).toLocaleUpperCase('es-PE'); }
function formatNames(v) { return normalizeSpaces(v).toLocaleLowerCase('es-PE').split(' ').filter(Boolean).map((w) => w.charAt(0).toLocaleUpperCase('es-PE') + w.slice(1)).join(' '); }
function parseStudentCodes({ studentCod, studentCods }) { return [...new Set([studentCod, studentCods].join('|').split(/[\/,|;]+/).map((v) => normalizeSpaces(v)).filter(Boolean))]; }
function mapRow(raw) { return { studentCod: normalizeSpaces(raw.studentcod), studentCods: normalizeSpaces(raw.studentcods), relationship: normalizeSpaces(raw.relationship), lastNames: normalizeSpaces(raw.lastnames), names: normalizeSpaces(raw.names), dni: normalizeDni(raw.dni), gender: normalizeSpaces(raw.gender).toUpperCase(), phones: normalizeSpaces(raw.phones), notes: normalizeSpaces(raw.notes), admissionFee: normalizeSpaces(raw.admission_fee), enrollmentFee: normalizeSpaces(raw.enrollment_fee), tuition: normalizeSpaces(raw.tuition) }; }
function normalizeRelationship(input) { const key = String(input || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase(); return REL[key] || null; }
function resolveTutorGender({ gender, relationship }) { const g = String(gender || '').trim().toUpperCase(); if (g === 'M' || g === 'F') return g; const r = String(relationship || '').trim().toUpperCase(); if (['PADRE', 'ABUELO', 'HERMANO', 'TIO'].includes(r)) return 'M'; if (['MADRE', 'ABUELA', 'HERMANA', 'TIA'].includes(r)) return 'F'; return null; }
function hasTutorIdentity(data) { return Boolean((data.names && data.lastNames) || data.dni); }
function parseFeeCell(rawValue, { allowDiscount = false, allowBeca = false } = {}) { const raw = normalizeSpaces(rawValue); const normalized = raw.toUpperCase().replace(',', '.'); if (!normalized) return { kind: 'EMPTY', raw, amount: null }; if (allowDiscount && normalized.includes('DESCUENTO')) return { kind: 'DESCUENTO', raw }; if (allowBeca && normalized.includes('BECA')) return { kind: 'BECA', raw }; if (normalized.includes('EXO')) return { kind: 'EXO', raw }; const match = normalized.match(/(\d+(?:\.\d+)?)/); if (match) return { kind: 'NUMERIC', raw, amount: Number(match[1]), hadExtraText: raw !== match[1] }; return { kind: 'INVALID', raw }; }
function buildPensions(cell) { if (cell.kind === 'NUMERIC') return Array(SCHOOL_MONTHS).fill(Number(cell.amount || 0)); if (cell.kind === 'EXO' || cell.kind === 'BECA') return Array(SCHOOL_MONTHS).fill(0); return Array(SCHOOL_MONTHS).fill(NO_APLICA_PENSION); }
function buildAdmissionFee(cell) { if (cell.kind === 'EXO') return { applies: true, amount: 0, isExempt: true, reason: EXEMPTION_REASON }; if (cell.kind === 'NUMERIC') return { applies: true, amount: Number(cell.amount || 0), isExempt: false, reason: '' }; return { applies: false, amount: 0, isExempt: false, reason: '' }; }
function buildEnrollmentFee(cell) { if (cell.kind === 'EXO') return { amount: 0, isExempt: true, reason: EXEMPTION_REASON }; if (cell.kind === 'NUMERIC') return { amount: Number(cell.amount || 0), isExempt: false, reason: '' }; return { amount: 0, isExempt: false, reason: '' }; }
function decimalAmount(amount) { return mongoose.Types.Decimal128.fromString(Number(amount).toFixed(2)); }
function ensureLogsDir() { const logsDir = path.resolve(process.cwd(), 'logs'); fs.mkdirSync(logsDir, { recursive: true }); return logsDir; }
async function getActiveCycle() { const now = new Date(); const current = await Cycle.findOne({ type: 'SCHOOL_YEAR', isActive: true, startDate: { $lte: now }, endDate: { $gte: now } }).sort({ startDate: -1 }).lean(); if (current) return current; return Cycle.findOne({ type: 'SCHOOL_YEAR', isActive: true }).sort({ startDate: -1 }).lean(); }
async function buildStudentCache() { const students = await Student.find({}).select('_id internalCode previousCampus').lean(); return new Map(students.map((row) => [row.internalCode, row])); }

async function resolveTutorPerson(data, normalizedPhones, cache, report) {
  const names = formatNames(data.names);
  const lastNames = formatLastNames(data.lastNames);
  let person = null;
  if (data.dni) {
    const cached = cache.get(data.dni);
    if (cached) person = cached;
    else {
      person = await Person.findOne({ dni: data.dni });
      if (person) cache.set(data.dni, person);
    }
  }
  if (!person && !data.dni && names && lastNames) {
    const candidates = await Person.find({ names, lastNames }).limit(2);
    if (candidates.length === 1) person = candidates[0];
  }
  const phone = normalizedPhones[0];
  const extraPhones = normalizedPhones.slice(1);
  const extraNote = extraPhones.length ? `Telefonos adicionales: ${extraPhones.join(', ')}` : '';
  if (!person) {
    if (!names || !lastNames) throw new Error('No se puede crear Person del tutor: faltan names/lastNames y no existe dni previo');
    try {
      person = await Person.create({ names, lastNames, ...(data.dni ? { dni: data.dni } : {}), gender: data.gender, ...(phone ? { phone } : {}), ...(extraNote ? { notes: extraNote } : {}) });
      report.peopleCreated += 1;
    } catch (error) {
      if (error?.code === 11000 && data.dni) person = await Person.findOne({ dni: data.dni });
      else throw error;
    }
    if (person && data.dni) cache.set(data.dni, person);
    return person;
  }
  const setUpdates = {};
  if (names && person.names !== names) setUpdates.names = names;
  if (lastNames && person.lastNames !== lastNames) setUpdates.lastNames = lastNames;
  if (data.dni && person.dni !== data.dni) setUpdates.dni = data.dni;
  if (person.gender !== data.gender) setUpdates.gender = data.gender;
  if (phone && person.phone !== phone) setUpdates.phone = phone;
  if (extraNote && !(person.notes || '').includes(extraNote)) setUpdates.notes = person.notes ? `${person.notes} | ${extraNote}` : extraNote;
  if (Object.keys(setUpdates).length) {
    await Person.updateOne({ _id: person._id }, { $set: setUpdates });
    report.peopleUpdated += 1;
    person = await Person.findById(person._id);
  }
  if (person?.dni) cache.set(person.dni, person);
  return person;
}

async function upsertTutorForStudent({ student, person, relationship, notes }, report) {
  let tutor = await Tutor.findOne({ studentId: student._id, tutorPersonId: person._id });
  const existingPrimary = await Tutor.findOne({ studentId: student._id, isPrimary: true });
  const shouldBePrimary = !existingPrimary || ['Madre', 'Padre'].includes(relationship);
  if (!tutor) {
    tutor = await Tutor.create({ studentId: student._id, tutorPersonId: person._id, relationship, isPrimary: shouldBePrimary, livesWithStudent: true, ...(notes ? { notes } : {}) });
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
  if (shouldBePrimary) await Tutor.updateMany({ studentId: student._id, _id: { $ne: tutor._id }, isPrimary: true }, { $set: { isPrimary: false } });
  return tutor;
}

function buildEnrollmentCandidate({ rowNumber, student, tutorPersonId, data, report }) {
  const admissionCell = parseFeeCell(data.admissionFee);
  const enrollmentCell = parseFeeCell(data.enrollmentFee);
  const tuitionCell = parseFeeCell(data.tuition, { allowDiscount: true, allowBeca: true });
  const invalidCells = [admissionCell, enrollmentCell, tuitionCell].filter((c) => c.kind === 'INVALID');
  if (invalidCells.length) return { kind: 'SKIP', reason: `Celdas de costo invalidas: ${invalidCells.map((c) => c.raw).join(', ')}` };
  if (admissionCell.hadExtraText || enrollmentCell.hadExtraText || tuitionCell.hadExtraText) report.warnings += 1;
  if (tuitionCell.kind === 'DESCUENTO') return { kind: 'SKIP', reason: 'TUITION = DESCUENTO; no se crea matricula ni cargos pendientes' };
  if (tuitionCell.kind === 'BECA' && !hasTutorIdentity(data)) return { kind: 'SKIP', reason: 'TUITION = BECA pero no hay tutor suficiente para crear matricula' };
  const internalPreviousSchool = ['CIENCIAS', 'CIENCIAS_APLICADAS', 'CIMAS'].includes(String(student.previousCampus || '').toUpperCase()) ? String(student.previousCampus).toUpperCase() : 'CIENCIAS';
  const notes = [data.notes, tuitionCell.kind === 'BECA' ? 'Becado' : '', tuitionCell.kind === 'EXO' || admissionCell.kind === 'EXO' || enrollmentCell.kind === 'EXO' ? EXEMPTION_REASON : ''].filter(Boolean).join(' | ');
  return { kind: 'ENROLL', rowNumber, importGroupKey: String(rowNumber), studentId: String(student._id), studentCode: student.internalCode, tutorPersonId: String(tutorPersonId), admissionFee: buildAdmissionFee(admissionCell), enrollmentFee: buildEnrollmentFee(enrollmentCell), pensionMonthlyAmounts: buildPensions(tuitionCell), previousSchoolType: ['EXO', 'NUMERIC'].includes(admissionCell.kind) ? 'OTHER' : internalPreviousSchool, previousSchoolName: ['EXO', 'NUMERIC'].includes(admissionCell.kind) ? OTHER_SCHOOL_NAME : null, notes };
}

function buildTuitionDescription(monthIndex, scheduleRow) { return scheduleRow?.label || `Pension ${monthIndex + 1}`; }

async function createEnrollmentsFromCandidates({ candidates, report, enrollmentSuccessRows, enrollmentSkippedRows, enrollmentErrorRows }) {
  if (!candidates.length) return;
  const activeCycle = await getActiveCycle();
  if (!activeCycle?._id) { enrollmentErrorRows.push({ reason: 'No existe un ciclo escolar activo para crear matriculas' }); return; }
  const uniqueStudentIds = [...new Set(candidates.map((row) => row.studentId))].map((id) => new mongoose.Types.ObjectId(id));
  const [students, vacancies, existingEnrollmentStudents] = await Promise.all([
    Student.find({ _id: { $in: uniqueStudentIds } }).select('_id internalCode previousCampus').lean(),
    Vacancy.find({ studentId: { $in: uniqueStudentIds }, cycleId: activeCycle._id }).populate('classroomId', '_id campusId cycleId displayName').lean(),
    EnrollmentStudent.find({ studentId: { $in: uniqueStudentIds } }).populate({ path: 'enrollmentId', select: 'cycleId' }).select('studentId enrollmentId').lean(),
  ]);
  const studentById = new Map(students.map((row) => [String(row._id), row]));
  const vacancyByStudentId = new Map(vacancies.map((row) => [String(row.studentId), row]));
  const alreadyEnrolledStudentIds = new Set(existingEnrollmentStudents.filter((row) => String(row.enrollmentId?.cycleId || '') === String(activeCycle._id)).map((row) => String(row.studentId)));
  const grouped = new Map();
  for (const candidate of candidates) {
    const student = studentById.get(candidate.studentId);
    if (!student) { enrollmentSkippedRows.push({ rowNumber: candidate.rowNumber, studentCod: candidate.studentCode, reason: 'Student no encontrado al preparar matricula' }); report.enrollmentSkipped += 1; continue; }
    if (alreadyEnrolledStudentIds.has(candidate.studentId)) { enrollmentSkippedRows.push({ rowNumber: candidate.rowNumber, studentCod: candidate.studentCode, reason: 'El estudiante ya tiene matricula en el ciclo activo' }); report.enrollmentSkipped += 1; continue; }
    const vacancy = vacancyByStudentId.get(candidate.studentId);
    if (!vacancy?.classroomId?._id) { enrollmentSkippedRows.push({ rowNumber: candidate.rowNumber, studentCod: candidate.studentCode, reason: 'No existe vacancy/classroom del ciclo activo para crear matricula' }); report.enrollmentSkipped += 1; continue; }
    const groupKey = `${candidate.importGroupKey}:${String(vacancy.classroomId.campusId)}`;
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey).push({ ...candidate, classroomId: vacancy.classroomId._id, campusId: vacancy.classroomId.campusId, student });
  }
  const { byCode, missingCodes } = await resolveBillingConceptsByCode({ requiredCodes: ['ADMISSION_FEE', 'ENROLLMENT_FEE', 'TUITION'] });
  if (missingCodes.length) { enrollmentErrorRows.push({ reason: `Faltan BillingConcept requeridos para crear matriculas: ${missingCodes.join(', ')}` }); return; }
  const schedules = await BillingSchedule.find({ cycleId: activeCycle._id, conceptCode: { $in: ['ADMISSION_FEE', 'ENROLLMENT_FEE', 'TUITION'] } }).lean();
  const tuitionSchedulesByMonth = new Map(schedules.filter((row) => row.conceptCode === 'TUITION' && row.monthIndex !== null && row.monthIndex !== undefined).map((row) => [Number(row.monthIndex), row]));
  for (const entries of grouped.values()) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      const immediateDueDate = new Date();
      const first = entries[0];
      const enrollment = await Enrollment.create([{ cycleId: activeCycle._id, campusId: first.campusId, campusIds: [first.campusId], status: 'CONFIRMED', confirmedAt: new Date(), notes: ENROLL_NOTES, ...(entries.some((row) => row.previousSchoolType === 'OTHER') ? { originSchool: OTHER_SCHOOL_NAME } : {}) }], { session }).then((docs) => docs[0]);
      const enrollmentStudents = [];
      const chargesToCreate = [];
      for (const entry of entries) {
        const enrollmentStudent = new EnrollmentStudent({ enrollmentId: enrollment._id, studentId: entry.student._id, classroomId: entry.classroomId, previousSchoolType: entry.previousSchoolType, ...(entry.previousSchoolType === 'OTHER' ? { previousSchoolName: entry.previousSchoolName } : {}), admissionFee: entry.admissionFee, enrollmentFee: entry.enrollmentFee, pensionMonthlyAmounts: entry.pensionMonthlyAmounts, agreedAt: new Date(), notes: entry.notes || undefined, chargesGeneratedAt: new Date() });
        await enrollmentStudent.save({ session });
        enrollmentStudents.push(enrollmentStudent);
        await upsertStudentCycleForEnrollment({ studentId: entry.student._id, cycleId: activeCycle._id, campusId: entry.campusId, enrollmentId: enrollment._id, session });
        if (entry.admissionFee.applies && entry.admissionFee.isExempt !== true && Number(entry.admissionFee.amount || 0) > 0) chargesToCreate.push({ studentId: entry.student._id, cycleId: activeCycle._id, campusId: entry.campusId, conceptId: byCode.get('ADMISSION_FEE'), concept: 'ADMISSION', description: 'Derecho de ingreso', totalAmount: decimalAmount(entry.admissionFee.amount), outstandingAmount: decimalAmount(entry.admissionFee.amount), dueDate: immediateDueDate, status: 'OPEN', ...(entry.admissionFee.reason ? { notes: entry.admissionFee.reason } : {}) });
        if (entry.enrollmentFee.isExempt !== true && Number(entry.enrollmentFee.amount || 0) > 0) chargesToCreate.push({ studentId: entry.student._id, cycleId: activeCycle._id, campusId: entry.campusId, conceptId: byCode.get('ENROLLMENT_FEE'), concept: 'ENROLLMENT', description: 'Matricula', totalAmount: decimalAmount(entry.enrollmentFee.amount), outstandingAmount: decimalAmount(entry.enrollmentFee.amount), dueDate: immediateDueDate, status: 'OPEN', ...(entry.enrollmentFee.reason ? { notes: entry.enrollmentFee.reason } : {}) });
        entry.pensionMonthlyAmounts.forEach((amount, monthIndex) => { const n = Number(amount || 0); if (n <= 0) return; const scheduleRow = tuitionSchedulesByMonth.get(monthIndex) || null; chargesToCreate.push({ studentId: entry.student._id, cycleId: activeCycle._id, campusId: entry.campusId, conceptId: byCode.get('TUITION'), concept: 'TUITION', monthIndex, description: buildTuitionDescription(monthIndex, scheduleRow), totalAmount: decimalAmount(n), outstandingAmount: decimalAmount(n), dueDate: scheduleRow?.dueDate || null, status: 'OPEN' }); });
        enrollmentSuccessRows.push({ rowNumber: entry.rowNumber, studentCod: entry.studentCode, tutorPersonId: entry.tutorPersonId, enrollmentId: String(enrollment._id) });
      }
      if (chargesToCreate.length) await Charge.insertMany(chargesToCreate, { session });
      enrollment.enrollmentStudents = enrollmentStudents.map((row) => row._id);
      enrollment.studentIds = enrollmentStudents.map((row) => row.studentId);
      await enrollment.save({ session });
      await session.commitTransaction();
      report.enrollmentsCreated += 1;
      report.enrollmentStudentsCreated += enrollmentStudents.length;
      report.chargesCreated += chargesToCreate.length;
    } catch (error) {
      await session.abortTransaction();
      report.enrollmentErrors += 1;
      enrollmentErrorRows.push({ rowNumber: entries[0]?.rowNumber || null, studentCods: entries.map((entry) => entry.studentCode), tutorPersonIds: [...new Set(entries.map((entry) => entry.tutorPersonId))], reason: error.message });
    } finally { await session.endSession(); }
  }
}

async function run() {
  const args = parseArgs(process.argv);
  const quiet = parseBooleanFlag(args.quiet);
  const selectedFile = String(args.file || DEFAULT_FILE);
  const campusFilter = resolveCampusFilter(args.campus);
  const filePath = path.resolve(process.cwd(), selectedFile);
  if (!fs.existsSync(filePath)) { console.error(`Archivo no encontrado: ${filePath}`); process.exit(1); }
  await connectDB();
  const report = { totalRows: 0, rowsInvalid: 0, skipped: 0, errors: 0, warnings: 0, peopleCreated: 0, peopleUpdated: 0, tutorsCreated: 0, tutorsUpdated: 0, tutorLinksProcessed: 0, missingStudents: 0, enrollmentsCreated: 0, enrollmentStudentsCreated: 0, chargesCreated: 0, enrollmentSkipped: 0, enrollmentErrors: 0 };
  const successRows = []; const errorRows = []; const skippedRows = []; const enrollmentSuccessRows = []; const enrollmentSkippedRows = []; const enrollmentErrorRows = [];
  const studentByCodeCache = await buildStudentCache(); const personByDniCache = new Map(); const enrollmentCandidates = [];
  try {
    if (!quiet) { console.log(`Archivo origen: ${selectedFile}`); console.log(`Campus aplicado: ${campusFilter || 'todos'}`); }
    const rows = parseCSV(fs.readFileSync(filePath, 'utf8')); report.totalRows = rows.length; const progress = createProgressTracker({ scriptName: 'importTutors', total: rows.length, quiet }); let processed = 0; let ok = 0; let invalid = 0; let errors = 0;
    for (const row of rows) {
      const mapped = mapRow(row.raw); const parsed = rowSchema.safeParse(mapped);
      if (!parsed.success) { report.rowsInvalid += 1; invalid += 1; processed += 1; errorRows.push({ rowNumber: row.rowNumber, studentCod: mapped.studentCod || null, reason: parsed.error.issues.map((issue) => issue.message).join('; ') }); progress.render({ processed, ok, invalid, errors }); continue; }
      const data = parsed.data; const studentCodes = parseStudentCodes(data);
      if (!studentCodes.length) { report.skipped += 1; processed += 1; skippedRows.push({ rowNumber: row.rowNumber, reason: 'No hay studentCod/studentCods validos en la fila' }); progress.render({ processed, ok, invalid, errors }); continue; }
      const students = studentCodes.map((code) => studentByCodeCache.get(code)).filter(Boolean).map((student) => ({ ...student })); const missingCodes = studentCodes.filter((code) => !studentByCodeCache.has(code));
      if (missingCodes.length) { report.missingStudents += missingCodes.length; skippedRows.push({ rowNumber: row.rowNumber, studentCod: missingCodes.join(','), reason: 'No existe Student para studentCod' }); }
      const campusFilteredStudents = campusFilter ? students.filter((student) => normalizeCampusCode(student.previousCampus) === campusFilter) : students;
      if (campusFilter && students.length > 0 && campusFilteredStudents.length === 0) { report.skipped += 1; processed += 1; skippedRows.push({ rowNumber: row.rowNumber, studentCod: studentCodes.join(','), reason: `Ningun alumno de la fila pertenece al campus seleccionado (${campusFilter})` }); progress.render({ processed, ok, invalid, errors }); continue; }
      if (!campusFilteredStudents.length) { report.skipped += 1; processed += 1; progress.render({ processed, ok, invalid, errors }); continue; }
      const relationship = normalizeRelationship(data.relationship); const tutorIdentityPresent = hasTutorIdentity(data); const resolvedTutorGender = resolveTutorGender(data);
      if (!tutorIdentityPresent) { report.skipped += 1; skippedRows.push({ rowNumber: row.rowNumber, studentCod: studentCodes.join(','), reason: 'Faltan datos del tutor (names+lastNames o dni)' }); for (const student of campusFilteredStudents) { const candidate = buildEnrollmentCandidate({ rowNumber: row.rowNumber, student, tutorPersonId: '', data, report }); enrollmentSkippedRows.push({ rowNumber: row.rowNumber, studentCod: student.internalCode, reason: candidate.kind === 'SKIP' ? candidate.reason : 'No se crea matricula porque falta tutor suficiente' }); report.enrollmentSkipped += 1; } processed += 1; progress.render({ processed, ok, invalid, errors }); continue; }
      if (!relationship) { report.skipped += 1; processed += 1; skippedRows.push({ rowNumber: row.rowNumber, studentCod: studentCodes.join(','), reason: `relationship no permitido: ${data.relationship || '(vacio)'}` }); progress.render({ processed, ok, invalid, errors }); continue; }
      if (!resolvedTutorGender) { report.skipped += 1; processed += 1; skippedRows.push({ rowNumber: row.rowNumber, studentCod: studentCodes.join(','), reason: 'gender del tutor es obligatorio para crear Person' }); progress.render({ processed, ok, invalid, errors }); continue; }
      data.gender = resolvedTutorGender;
      try {
        const person = await resolveTutorPerson(data, normalizePhones(data.phones), personByDniCache, report);
        for (const student of campusFilteredStudents) {
          const tutor = await upsertTutorForStudent({ student, person, relationship, notes: data.notes }, report);
          report.tutorLinksProcessed += 1;
          successRows.push({ rowNumber: row.rowNumber, studentCod: student.internalCode, studentId: student._id, tutorPersonId: person._id, tutorId: tutor._id, relationship });
          const candidate = buildEnrollmentCandidate({ rowNumber: row.rowNumber, student, tutorPersonId: person._id, data, report });
          if (candidate.kind === 'SKIP') { enrollmentSkippedRows.push({ rowNumber: row.rowNumber, studentCod: student.internalCode, reason: candidate.reason }); report.enrollmentSkipped += 1; } else enrollmentCandidates.push(candidate);
        }
        ok += 1;
      } catch (error) { report.errors += 1; errors += 1; errorRows.push({ rowNumber: row.rowNumber, studentCod: studentCodes.join(',') || null, reason: error.message }); }
      processed += 1; progress.render({ processed, ok, invalid, errors });
    }
    progress.render({ processed, ok, invalid, errors, force: true }); progress.finish();
    await createEnrollmentsFromCandidates({ candidates: enrollmentCandidates, report, enrollmentSuccessRows, enrollmentSkippedRows, enrollmentErrorRows });
    const logsDir = ensureLogsDir();
    fs.writeFileSync(path.join(logsDir, 'import-tutors-success.json'), JSON.stringify(successRows, null, 2), 'utf8');
    fs.writeFileSync(path.join(logsDir, 'import-tutors-errors.json'), JSON.stringify(errorRows, null, 2), 'utf8');
    fs.writeFileSync(path.join(logsDir, 'import-tutors-skipped.json'), JSON.stringify(skippedRows, null, 2), 'utf8');
    fs.writeFileSync(path.join(logsDir, 'import-tutors-enrollments-success.json'), JSON.stringify(enrollmentSuccessRows, null, 2), 'utf8');
    fs.writeFileSync(path.join(logsDir, 'import-tutors-enrollments-skipped.json'), JSON.stringify(enrollmentSkippedRows, null, 2), 'utf8');
    fs.writeFileSync(path.join(logsDir, 'import-tutors-enrollments-errors.json'), JSON.stringify(enrollmentErrorRows, null, 2), 'utf8');
    console.log('===== Import Tutors + Enrollments Summary =====');
    console.log(`Total filas: ${report.totalRows}`); console.log(`Filas invalidas: ${report.rowsInvalid}`); console.log(`Omitidos: ${report.skipped}`); console.log(`Errores de proceso: ${report.errors}`); console.log(`Warnings: ${report.warnings}`); console.log(`People creadas: ${report.peopleCreated}`); console.log(`People actualizadas: ${report.peopleUpdated}`); console.log(`Tutores creados: ${report.tutorsCreated}`); console.log(`Tutores actualizados: ${report.tutorsUpdated}`); console.log(`Vinculos tutor-alumno procesados: ${report.tutorLinksProcessed}`); console.log(`StudentCod sin alumno: ${report.missingStudents}`); console.log(`Matriculas creadas: ${report.enrollmentsCreated}`); console.log(`EnrollmentStudents creados: ${report.enrollmentStudentsCreated}`); console.log(`Cargos creados: ${report.chargesCreated}`); console.log(`Matriculas omitidas: ${report.enrollmentSkipped}`); console.log(`Errores creando matriculas: ${report.enrollmentErrors}`); console.log(`Logs: ${logsDir}`);
    process.exit(0);
  } catch (error) { console.error('Error ejecutando importTutors:', error); process.exit(1); } finally { await mongoose.connection.close(); }
}

run();
