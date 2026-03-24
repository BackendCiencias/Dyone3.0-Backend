import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { z } from 'zod';
import { connectDB } from '../src/config/db.js';
import { Student } from '../src/models/student.model.js';
import { Person } from '../src/models/person.model.js';
import { Tutor } from '../src/models/tutor.model.js';
import { Campus } from '../src/models/campus.model.js';
import { Enrollment } from '../src/models/enrollment.model.js';
import { EnrollmentStudent, NO_APLICA_PENSION } from '../src/models/enrollmentStudent.model.js';
import { Vacancy } from '../src/models/vacancy.model.js';
import { Classroom } from '../src/models/classroom.model.js';
import { BillingSchedule } from '../src/models/billingSchedule.model.js';
import { Charge } from '../src/models/charge.model.js';
import { Cycle } from '../src/models/cycle.model.js';
import { resolveBillingConceptsByCode } from '../src/modules/enrollments/services/enrollmentConfirmation.helpers.js';

const REL = { PADRE: 'Padre', MADRE: 'Madre', ABUELO: 'Abuelo', ABUELA: 'Abuela', HERMANO: 'Hermano', HERMANA: 'Hermana', TIO: 'Tío', TIA: 'Tía', APODERADO: 'Apoderado', OTRO: 'Otro' };
const ENROLL_NOTES = 'Matricula actualizada por importacion masiva de tutores';
const EXEMPTION_REASON = 'Exonerado por secretaria, pendiente de revision';
const OTHER_SCHOOL_NAME = 'Colegio Desconocido';
const DEFAULT_FILE = './data/parents.csv';
const SCHOOL_MONTHS = 10;
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

const norm = (v) => String(v || '').trim().replace(/\s+/g, ' ');
const normDni = (v) => { const n = norm(v); return !n || ['null', 'undefined', 'n/a', 'na', '-'].includes(n.toLowerCase()) ? undefined : n; };
const upper = (v) => norm(v).toLocaleUpperCase('es-PE');
const resolveCampusFilter = (value) => { if (!value) return null; const normalized = upper(value); if (!ALLOWED_CAMPUSES.includes(normalized)) throw new Error(`Campus invalido para --campus: ${value}. Permitidos: ${ALLOWED_CAMPUSES.join(', ')}`); return normalized; };
const formatNames = (v) => norm(v).toLocaleLowerCase('es-PE').split(' ').filter(Boolean).map((w) => w[0].toLocaleUpperCase('es-PE') + w.slice(1)).join(' ');
const formatLastNames = (v) => norm(v).toLocaleUpperCase('es-PE');
const parseBool = (v) => typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'y', 'on'].includes(String(v || '').trim().toLowerCase());
const formatDurationMs = (ms) => { const s = Math.floor(Math.max(0, ms || 0) / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const decimal = (v) => mongoose.Types.Decimal128.fromString(Number(v).toFixed(2));
const ensureLogsDir = () => { const dir = path.resolve(process.cwd(), 'logs'); fs.mkdirSync(dir, { recursive: true }); return dir; };
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
      if (!force && processed !== total && processed % step !== 0) return;
      const elapsed = Date.now() - startedAt;
      const pct = Math.floor((processed / total) * 100);
      const avg = processed > 0 ? elapsed / processed : 0;
      const eta = processed > 0 ? Math.max(0, (total - processed) * avg) : 0;
      const line = `\r${pct}% (${processed}/${total}) | ok:${ok} invalid:${invalid} errors:${errors} | elapsed:${formatDurationMs(elapsed)} ETA:${formatDurationMs(eta)}`;
      process.stdout.write(line + ' '.repeat(Math.max(0, lastLineLength - line.length)));
      lastLineLength = line.length;
      hasRendered = true;
    },
    finish() {
      if (!quiet && hasRendered) console.log('');
    },
  };
}

function parseArgs(argv) { const args = {}; for (let i = 2; i < argv.length; i += 1) { const c = argv[i]; if (!c.startsWith('--')) continue; const k = c.slice(2); const v = argv[i + 1]; if (!v || v.startsWith('--')) args[k] = true; else { args[k] = v; i += 1; } } return args; }
function parseCSV(content) { const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean); if (!lines.length) return []; const h = lines[0]; const counts = [['\t', (h.match(/\t/g) || []).length], [',', (h.match(/,/g) || []).length], [';', (h.match(/;/g) || []).length]].sort((a, b) => b[1] - a[1]); const d = counts[0][0]; const headers = h.split(d).map((v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()); return lines.slice(1).map((line, idx) => { const values = line.split(d).map((v) => v.trim()); const raw = {}; headers.forEach((key, i) => { raw[key] = values[i] || ''; }); return { rowNumber: idx + 2, raw }; }); }
function parseCodes({ studentCod, studentCods }) { return [...new Set([studentCod, studentCods].join('|').split(/[\/,|;]+/).map(norm).filter(Boolean))]; }
function parsePhones(v) { return norm(v).split(/[\/,|;]+/).map((x) => x.trim()).filter(Boolean).map((x) => x.replace(/\D/g, '')).filter(Boolean); }
function mapRow(raw) { return { studentCod: norm(raw.studentcod), studentCods: norm(raw.studentcods), relationship: norm(raw.relationship), lastNames: norm(raw.lastnames), names: norm(raw.names), dni: normDni(raw.dni), gender: upper(raw.gender), phones: norm(raw.phones), notes: norm(raw.notes), admissionFee: norm(raw.admission_fee), enrollmentFee: norm(raw.enrollment_fee), tuition: norm(raw.tuition) }; }
function mapRel(input) { const key = String(input || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase(); return REL[key] || null; }
function inferGender({ gender, relationship }) { const g = upper(gender); if (g === 'M' || g === 'F') return g; const r = upper(relationship); if (['PADRE', 'ABUELO', 'HERMANO', 'TIO'].includes(r)) return 'M'; if (['MADRE', 'ABUELA', 'HERMANA', 'TIA'].includes(r)) return 'F'; return null; }
function hasTutor(data) { return Boolean((data.names && data.lastNames) || data.dni); }
function parseFee(raw, opts = {}) { const txt = norm(raw); const n = txt.toUpperCase().replace(',', '.'); if (!n) return { kind: 'EMPTY', raw: txt }; if (opts.allowDiscount && n.includes('DESCUENTO')) return { kind: 'DESCUENTO', raw: txt }; if (opts.allowBeca && n.includes('BECA')) return { kind: 'BECA', raw: txt }; if (n.includes('EXO')) return { kind: 'EXO', raw: txt }; const m = n.match(/(\d+(?:\.\d+)?)/); if (m) return { kind: 'NUMERIC', raw: txt, amount: Number(m[1]), hadExtraText: txt !== m[1] }; return { kind: 'INVALID', raw: txt }; }
function hasTuition(cell) { return ['NUMERIC', 'EXO', 'BECA'].includes(cell.kind); }
function buildPensions(cell) { if (cell.kind === 'NUMERIC') return Array(SCHOOL_MONTHS).fill(Number(cell.amount || 0)); if (cell.kind === 'EXO' || cell.kind === 'BECA') return Array(SCHOOL_MONTHS).fill(0); return Array(SCHOOL_MONTHS).fill(NO_APLICA_PENSION); }
function buildAdmission(cell) { if (cell.kind === 'EXO') return { applies: true, amount: 0, isExempt: true, reason: EXEMPTION_REASON }; if (cell.kind === 'NUMERIC') return { applies: true, amount: Number(cell.amount || 0), isExempt: false, reason: '' }; return { applies: false, amount: 0, isExempt: false, reason: '' }; }
function buildEnrollmentFee(cell) { if (cell.kind === 'EXO') return { amount: 0, isExempt: true, reason: EXEMPTION_REASON }; if (cell.kind === 'NUMERIC') return { amount: Number(cell.amount || 0), isExempt: false, reason: '' }; return { amount: 0, isExempt: false, reason: '' }; }
function prevCampusByClassroom(classroom) { const level = upper(classroom?.level); const grade = Number.parseInt(String(classroom?.grade || '').trim(), 10); if (level === 'SECONDARY' && Number.isFinite(grade) && grade >= 2) return 'Ciencias'; return 'Ciencias Aplicadas'; }
function resolvePreviousCampusLabel(admissionCell, classroom) { return ['EXO', 'NUMERIC'].includes(admissionCell.kind) ? 'Otro Colegio' : prevCampusByClassroom(classroom); }
function derivePreviousSchool(label) { const n = upper(label); if (n === 'OTRO COLEGIO') return { previousSchoolType: 'OTHER', previousSchoolName: OTHER_SCHOOL_NAME }; if (n === 'CIENCIAS APLICADAS') return { previousSchoolType: 'CIENCIAS_APLICADAS', previousSchoolName: null }; if (n === 'CIMAS') return { previousSchoolType: 'CIMAS', previousSchoolName: null }; return { previousSchoolType: 'CIENCIAS', previousSchoolName: null }; }
function tuitionDescription(monthIndex, schedule) { return schedule?.label || `Pension ${monthIndex + 1}`; }

async function getActiveCycle() {
  const now = new Date();
  const current = await Cycle.findOne({ type: 'SCHOOL_YEAR', isActive: true, startDate: { $lte: now }, endDate: { $gte: now } }).sort({ startDate: -1 }).lean();
  return current || Cycle.findOne({ type: 'SCHOOL_YEAR', isActive: true }).sort({ startDate: -1 }).lean();
}

async function buildStudentCache() {
  const students = await Student.find({}).select('_id internalCode previousCampus').lean();
  if (!students.length) return new Map();
  const activeCycle = await getActiveCycle();
  const studentIds = students.map((s) => s._id);
  const vacancies = activeCycle?._id ? await Vacancy.find({ studentId: { $in: studentIds }, cycleId: activeCycle._id }).select('studentId classroomId').lean() : [];
  const classroomIds = [...new Set(vacancies.map((r) => String(r.classroomId || '')).filter(Boolean))].map((id) => new mongoose.Types.ObjectId(id));
  const classrooms = classroomIds.length ? await Classroom.find({ _id: { $in: classroomIds } }).select('_id campusId').lean() : [];
  const campusIds = [...new Set(classrooms.map((r) => String(r.campusId || '')).filter(Boolean))].map((id) => new mongoose.Types.ObjectId(id));
  const campuses = campusIds.length ? await Campus.find({ _id: { $in: campusIds } }).select('_id code').lean() : [];
  const classroomById = new Map(classrooms.map((r) => [String(r._id), r]));
  const campusById = new Map(campuses.map((r) => [String(r._id), r]));
  const vacancyByStudentId = new Map(vacancies.map((r) => [String(r.studentId), r]));
  return new Map(students.map((student) => { const vacancy = vacancyByStudentId.get(String(student._id)); const classroom = vacancy ? classroomById.get(String(vacancy.classroomId)) : null; const campus = classroom ? campusById.get(String(classroom.campusId)) : null; return [student.internalCode, { ...student, currentCampusCode: campus?.code || null }]; }));
}

async function resolveTutorPerson(data, phones, cache, report) {
  const names = formatNames(data.names);
  const lastNames = formatLastNames(data.lastNames);
  let person = null;
  if (data.dni) { const cached = cache.get(data.dni); if (cached) person = cached; else { person = await Person.findOne({ dni: data.dni }); if (person) cache.set(data.dni, person); } }
  if (!person && !data.dni && names && lastNames) { const candidates = await Person.find({ names, lastNames }).limit(2); if (candidates.length === 1) person = candidates[0]; }
  const phone = phones[0]; const extraPhones = phones.slice(1); const extraNote = extraPhones.length ? `Telefonos adicionales: ${extraPhones.join(', ')}` : '';
  if (!person) {
    if (!names || !lastNames) throw new Error('No se puede crear Person del tutor: faltan names/lastNames y no existe dni previo');
    try { person = await Person.create({ names, lastNames, ...(data.dni ? { dni: data.dni } : {}), gender: data.gender, ...(phone ? { phone } : {}), ...(extraNote ? { notes: extraNote } : {}) }); report.peopleCreated += 1; } catch (error) { if (error?.code === 11000 && data.dni) person = await Person.findOne({ dni: data.dni }); else throw error; }
    if (person && data.dni) cache.set(data.dni, person);
    return person;
  }
  const set = {};
  if (names && person.names !== names) set.names = names;
  if (lastNames && person.lastNames !== lastNames) set.lastNames = lastNames;
  if (data.dni && person.dni !== data.dni) set.dni = data.dni;
  if (person.gender !== data.gender) set.gender = data.gender;
  if (phone && person.phone !== phone) set.phone = phone;
  if (extraNote && !(person.notes || '').includes(extraNote)) set.notes = person.notes ? `${person.notes} | ${extraNote}` : extraNote;
  if (Object.keys(set).length) { await Person.updateOne({ _id: person._id }, { $set: set }); report.peopleUpdated += 1; person = await Person.findById(person._id); }
  if (person?.dni) cache.set(person.dni, person);
  return person;
}

async function upsertTutorForStudent({ student, person, relationship, notes }, report) {
  let tutor = await Tutor.findOne({ studentId: student._id, tutorPersonId: person._id });
  const primary = await Tutor.findOne({ studentId: student._id, isPrimary: true });
  const shouldBePrimary = !primary || ['Madre', 'Padre'].includes(relationship);
  if (!tutor) { tutor = await Tutor.create({ studentId: student._id, tutorPersonId: person._id, relationship, isPrimary: shouldBePrimary, livesWithStudent: true, ...(notes ? { notes } : {}) }); report.tutorsCreated += 1; }
  else {
    const set = {};
    if (tutor.relationship !== relationship) set.relationship = relationship;
    if (tutor.livesWithStudent !== true) set.livesWithStudent = true;
    if (notes && tutor.notes !== notes) set.notes = notes;
    if (shouldBePrimary && tutor.isPrimary !== true) set.isPrimary = true;
    if (Object.keys(set).length) { await Tutor.updateOne({ _id: tutor._id }, { $set: set }); report.tutorsUpdated += 1; tutor = await Tutor.findById(tutor._id); }
  }
  if (shouldBePrimary) await Tutor.updateMany({ studentId: student._id, _id: { $ne: tutor._id }, isPrimary: true }, { $set: { isPrimary: false } });
  return tutor;
}

function buildCandidate({ rowNumber, student, tutorPersonId, data, report }) {
  const admissionCell = parseFee(data.admissionFee);
  const enrollmentCell = parseFee(data.enrollmentFee);
  const tuitionCell = parseFee(data.tuition, { allowDiscount: true, allowBeca: true });
  const invalid = [admissionCell, enrollmentCell, tuitionCell].filter((c) => c.kind === 'INVALID');
  if (invalid.length) return { kind: 'SKIP', reason: `Celdas de costo invalidas: ${invalid.map((c) => c.raw).join(', ')}` };
  if (admissionCell.hadExtraText || enrollmentCell.hadExtraText || tuitionCell.hadExtraText) report.warnings += 1;
  if (tuitionCell.kind === 'DESCUENTO') return { kind: 'SKIP', reason: 'TUITION = DESCUENTO; no se modifica matricula ni se crean cargos' };
  if (!hasTuition(tuitionCell)) return { kind: 'SKIP', reason: 'Sin monto de pension acordado; solo se vincula tutor' };
  const notes = [data.notes, tuitionCell.kind === 'BECA' ? 'Becado' : '', tuitionCell.kind === 'EXO' || admissionCell.kind === 'EXO' || enrollmentCell.kind === 'EXO' ? EXEMPTION_REASON : ''].filter(Boolean).join(' | ');
  return { kind: 'ENROLL', rowNumber, studentId: String(student._id), studentCode: student.internalCode, tutorPersonId: String(tutorPersonId), admissionCell, admissionFee: buildAdmission(admissionCell), enrollmentFee: buildEnrollmentFee(enrollmentCell), pensionMonthlyAmounts: buildPensions(tuitionCell), notes };
}

async function applyCandidates({ candidates, report, success, skipped, errors }) {
  if (!candidates.length) return;
  const activeCycle = await getActiveCycle();
  if (!activeCycle?._id) { errors.push({ reason: 'No existe un ciclo escolar activo para crear o modificar matriculas' }); return; }
  const ids = [...new Set(candidates.map((r) => r.studentId))].map((id) => new mongoose.Types.ObjectId(id));
  const [students, vacancies, existingRows, charges] = await Promise.all([
    Student.find({ _id: { $in: ids } }).select('_id internalCode previousCampus').lean(),
    Vacancy.find({ studentId: { $in: ids }, cycleId: activeCycle._id }).populate('classroomId', '_id campusId cycleId displayName level grade').lean(),
    EnrollmentStudent.find({ studentId: { $in: ids } }).populate({ path: 'enrollmentId', select: 'cycleId status campusId enrollmentStudents confirmedAt notes' }).select('studentId enrollmentId classroomId chargesGeneratedAt').lean(),
    Charge.find({ studentId: { $in: ids }, cycleId: activeCycle._id, status: { $ne: 'CANCELLED' } }).select('studentId').lean(),
  ]);
  const studentById = new Map(students.map((r) => [String(r._id), r]));
  const vacancyByStudentId = new Map(vacancies.map((r) => [String(r.studentId), r]));
  const existingByStudentId = new Map(existingRows.filter((r) => String(r.enrollmentId?.cycleId || '') === String(activeCycle._id)).map((r) => [String(r.studentId), r]));
  const chargeCountByStudentId = new Map(); for (const c of charges) { const k = String(c.studentId); chargeCountByStudentId.set(k, (chargeCountByStudentId.get(k) || 0) + 1); }
  const { byCode, missingCodes } = await resolveBillingConceptsByCode({ requiredCodes: ['ADMISSION_FEE', 'ENROLLMENT_FEE', 'TUITION'] });
  if (missingCodes.length) { errors.push({ reason: `Faltan BillingConcept requeridos para crear cargos: ${missingCodes.join(', ')}` }); return; }
  const schedules = await BillingSchedule.find({ cycleId: activeCycle._id, conceptCode: { $in: ['ADMISSION_FEE', 'ENROLLMENT_FEE', 'TUITION'] } }).lean();
  const tuitionScheduleByMonth = new Map(schedules.filter((r) => r.conceptCode === 'TUITION' && r.monthIndex !== null && r.monthIndex !== undefined).map((r) => [Number(r.monthIndex), r]));

  for (const candidate of candidates) {
    const student = studentById.get(candidate.studentId);
    const vacancy = vacancyByStudentId.get(candidate.studentId);
    if (!student) { skipped.push({ rowNumber: candidate.rowNumber, studentCod: candidate.studentCode, reason: 'Student no encontrado al preparar matricula' }); report.enrollmentSkipped += 1; continue; }
    if (!vacancy?.classroomId?._id) { skipped.push({ rowNumber: candidate.rowNumber, studentCod: candidate.studentCode, reason: 'No existe vacancy/classroom del ciclo activo para modificar matricula' }); report.enrollmentSkipped += 1; continue; }
    const existing = existingByStudentId.get(candidate.studentId) || null;
    const enrollment = existing?.enrollmentId || null;
    if (existing?.chargesGeneratedAt || (chargeCountByStudentId.get(candidate.studentId) || 0) > 0) { skipped.push({ rowNumber: candidate.rowNumber, studentCod: candidate.studentCode, reason: 'La matricula ya tiene cargos generados en el ciclo activo' }); report.enrollmentSkipped += 1; continue; }
    if (upper(enrollment?.status) === 'TRANSFERRED') { skipped.push({ rowNumber: candidate.rowNumber, studentCod: candidate.studentCode, reason: 'La matricula del ciclo activo esta trasladada y no se puede modificar' }); report.enrollmentSkipped += 1; continue; }

    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      const prevCampusLabel = resolvePreviousCampusLabel(candidate.admissionCell, vacancy.classroomId);
      const prevSchool = derivePreviousSchool(prevCampusLabel);
      const dueNow = new Date();
      if (String(student.previousCampus || '') !== prevCampusLabel) await Student.updateOne({ _id: student._id }, { $set: { previousCampus: prevCampusLabel } }, { session });

      let targetEnrollment = null;
      if (enrollment?._id) {
        await Enrollment.updateOne({ _id: enrollment._id }, { $set: { campusId: vacancy.classroomId.campusId, status: 'ENROLLED', confirmedAt: enrollment.confirmedAt || new Date(), notes: ENROLL_NOTES }, ...(existing?._id ? { $addToSet: { enrollmentStudents: existing._id } } : {}) }, { session });
        targetEnrollment = await Enrollment.findById(enrollment._id).session(session);
        report.enrollmentsUpdated += 1;
      } else {
        targetEnrollment = await Enrollment.create([{ cycleId: activeCycle._id, campusId: vacancy.classroomId.campusId, status: 'ENROLLED', confirmedAt: new Date(), notes: ENROLL_NOTES }], { session }).then((docs) => docs[0]);
        report.enrollmentsCreated += 1;
      }

      const esPayload = {
        enrollmentId: targetEnrollment._id,
        studentId: student._id,
        classroomId: vacancy.classroomId._id,
        previousSchoolType: prevSchool.previousSchoolType,
        ...(prevSchool.previousSchoolType === 'OTHER' ? { previousSchoolName: prevSchool.previousSchoolName } : {}),
        admissionFee: candidate.admissionFee,
        enrollmentFee: candidate.enrollmentFee,
        pensionMonthlyAmounts: candidate.pensionMonthlyAmounts,
        agreedAt: new Date(),
        notes: candidate.notes || undefined,
        chargesGeneratedAt: new Date(),
      };

      let enrollmentStudent = null;
      if (existing?._id) {
        await EnrollmentStudent.updateOne({ _id: existing._id }, { $set: esPayload }, { session });
        enrollmentStudent = await EnrollmentStudent.findById(existing._id).session(session);
        report.enrollmentStudentsUpdated += 1;
      } else {
        enrollmentStudent = new EnrollmentStudent(esPayload);
        await enrollmentStudent.save({ session });
        await Enrollment.updateOne({ _id: targetEnrollment._id }, { $addToSet: { enrollmentStudents: enrollmentStudent._id } }, { session });
        report.enrollmentStudentsCreated += 1;
      }

      const toCreate = [];
      if (candidate.admissionFee.applies && !candidate.admissionFee.isExempt && Number(candidate.admissionFee.amount || 0) > 0) toCreate.push({ studentId: student._id, cycleId: activeCycle._id, campusId: vacancy.classroomId.campusId, conceptId: byCode.get('ADMISSION_FEE'), concept: 'ADMISSION', description: 'Derecho de ingreso', totalAmount: decimal(candidate.admissionFee.amount), outstandingAmount: decimal(candidate.admissionFee.amount), dueDate: dueNow, status: 'OPEN', ...(candidate.admissionFee.reason ? { notes: candidate.admissionFee.reason } : {}) });
      if (!candidate.enrollmentFee.isExempt && Number(candidate.enrollmentFee.amount || 0) > 0) toCreate.push({ studentId: student._id, cycleId: activeCycle._id, campusId: vacancy.classroomId.campusId, conceptId: byCode.get('ENROLLMENT_FEE'), concept: 'ENROLLMENT', description: 'Matricula', totalAmount: decimal(candidate.enrollmentFee.amount), outstandingAmount: decimal(candidate.enrollmentFee.amount), dueDate: dueNow, status: 'OPEN', ...(candidate.enrollmentFee.reason ? { notes: candidate.enrollmentFee.reason } : {}) });
      candidate.pensionMonthlyAmounts.forEach((amount, monthIndex) => { const n = Number(amount || 0); if (n <= 0) return; const schedule = tuitionScheduleByMonth.get(monthIndex) || null; toCreate.push({ studentId: student._id, cycleId: activeCycle._id, campusId: vacancy.classroomId.campusId, conceptId: byCode.get('TUITION'), concept: 'TUITION', monthIndex, description: tuitionDescription(monthIndex, schedule), totalAmount: decimal(n), outstandingAmount: decimal(n), dueDate: schedule?.dueDate || null, status: 'OPEN' }); });
      if (toCreate.length) await Charge.insertMany(toCreate, { session });
      await session.commitTransaction();
      report.chargesCreated += toCreate.length;
      success.push({ rowNumber: candidate.rowNumber, studentCod: candidate.studentCode, tutorPersonId: candidate.tutorPersonId, enrollmentId: String(targetEnrollment._id), enrollmentStudentId: String(enrollmentStudent._id), previousCampus: prevCampusLabel });
    } catch (error) {
      await session.abortTransaction();
      report.enrollmentErrors += 1;
      errors.push({ rowNumber: candidate.rowNumber, studentCod: candidate.studentCode, tutorPersonId: candidate.tutorPersonId, reason: error.message });
    } finally {
      await session.endSession();
    }
  }
}

async function run() {
  const args = parseArgs(process.argv);
  const quiet = parseBool(args.quiet);
  const selectedFile = String(args.file || DEFAULT_FILE);
  const campusFilter = resolveCampusFilter(args.campus);
  const filePath = path.resolve(process.cwd(), selectedFile);
  if (!fs.existsSync(filePath)) { console.error(`Archivo no encontrado: ${filePath}`); process.exit(1); }

  await connectDB();
  const report = { totalRows: 0, rowsInvalid: 0, skipped: 0, errors: 0, warnings: 0, peopleCreated: 0, peopleUpdated: 0, tutorsCreated: 0, tutorsUpdated: 0, tutorLinksProcessed: 0, missingStudents: 0, enrollmentsCreated: 0, enrollmentsUpdated: 0, enrollmentStudentsCreated: 0, enrollmentStudentsUpdated: 0, chargesCreated: 0, enrollmentSkipped: 0, enrollmentErrors: 0 };
  const successRows = []; const errorRows = []; const skippedRows = []; const enrollmentSuccessRows = []; const enrollmentSkippedRows = []; const enrollmentErrorRows = [];
  const studentByCodeCache = await buildStudentCache(); const personByDniCache = new Map(); const candidates = [];

  try {
    if (!quiet) { console.log(`Archivo origen: ${selectedFile}`); console.log(`Campus aplicado: ${campusFilter || 'todos'}`); }
    const rows = parseCSV(fs.readFileSync(filePath, 'utf8')); report.totalRows = rows.length;
    const progress = createProgressTracker({ scriptName: 'importTutors', total: rows.length, quiet });
    let processed = 0; let ok = 0; let invalid = 0; let errors = 0;

    for (const row of rows) {
      const mapped = mapRow(row.raw);
      const parsed = rowSchema.safeParse(mapped);
      if (!parsed.success) { report.rowsInvalid += 1; invalid += 1; processed += 1; errorRows.push({ rowNumber: row.rowNumber, studentCod: mapped.studentCod || null, reason: parsed.error.issues.map((i) => i.message).join('; ') }); progress.render({ processed, ok, invalid, errors }); continue; }
      const data = parsed.data;
      const studentCodes = parseCodes(data);
      if (!studentCodes.length) { report.skipped += 1; processed += 1; skippedRows.push({ rowNumber: row.rowNumber, reason: 'No hay studentCod/studentCods validos en la fila' }); progress.render({ processed, ok, invalid, errors }); continue; }
      const students = studentCodes.map((code) => studentByCodeCache.get(code)).filter(Boolean).map((student) => ({ ...student }));
      const missingCodes = studentCodes.filter((code) => !studentByCodeCache.has(code));
      if (missingCodes.length) { report.missingStudents += missingCodes.length; skippedRows.push({ rowNumber: row.rowNumber, studentCod: missingCodes.join(','), reason: 'No existe Student para studentCod' }); }
      const campusStudents = campusFilter ? students.filter((student) => upper(student.currentCampusCode) === campusFilter) : students;
      if (campusFilter && students.length > 0 && campusStudents.length === 0) { report.skipped += 1; processed += 1; skippedRows.push({ rowNumber: row.rowNumber, studentCod: studentCodes.join(','), reason: `Ningun alumno de la fila pertenece al campus seleccionado (${campusFilter})` }); progress.render({ processed, ok, invalid, errors }); continue; }
      if (!campusStudents.length) { report.skipped += 1; processed += 1; progress.render({ processed, ok, invalid, errors }); continue; }

      const relationship = mapRel(data.relationship);
      const tutorIdentityPresent = hasTutor(data);
      const resolvedGender = inferGender(data);
      const tuitionCell = parseFee(data.tuition, { allowDiscount: true, allowBeca: true });

      if (!tutorIdentityPresent) {
        report.skipped += 1;
        skippedRows.push({ rowNumber: row.rowNumber, studentCod: studentCodes.join(','), reason: 'Faltan datos del tutor (names+lastNames o dni)' });
        for (const student of campusStudents) {
          if (hasTuition(tuitionCell)) { enrollmentErrorRows.push({ rowNumber: row.rowNumber, studentCod: student.internalCode, reason: 'No tiene tutor registrado pero si pago de pensión, matrícula no modificada. Revisar contrato físico.' }); report.enrollmentErrors += 1; }
          else { enrollmentSkippedRows.push({ rowNumber: row.rowNumber, studentCod: student.internalCode, reason: 'Sin tutor suficiente; solo se mantiene la matrícula actual' }); report.enrollmentSkipped += 1; }
        }
        processed += 1; progress.render({ processed, ok, invalid, errors }); continue;
      }

      if (!relationship) { report.skipped += 1; processed += 1; skippedRows.push({ rowNumber: row.rowNumber, studentCod: studentCodes.join(','), reason: `relationship no permitido: ${data.relationship || '(vacio)'}` }); progress.render({ processed, ok, invalid, errors }); continue; }
      if (!resolvedGender) { report.skipped += 1; processed += 1; skippedRows.push({ rowNumber: row.rowNumber, studentCod: studentCodes.join(','), reason: 'gender del tutor es obligatorio para crear Person' }); progress.render({ processed, ok, invalid, errors }); continue; }
      data.gender = resolvedGender;

      try {
        const person = await resolveTutorPerson(data, parsePhones(data.phones), personByDniCache, report);
        for (const student of campusStudents) {
          const tutor = await upsertTutorForStudent({ student, person, relationship, notes: data.notes }, report);
          report.tutorLinksProcessed += 1;
          successRows.push({ rowNumber: row.rowNumber, studentCod: student.internalCode, studentId: student._id, tutorPersonId: person._id, tutorId: tutor._id, relationship });
          const candidate = buildCandidate({ rowNumber: row.rowNumber, student, tutorPersonId: person._id, data, report });
          if (candidate.kind === 'SKIP') { enrollmentSkippedRows.push({ rowNumber: row.rowNumber, studentCod: student.internalCode, reason: candidate.reason }); report.enrollmentSkipped += 1; }
          else candidates.push(candidate);
        }
        ok += 1;
      } catch (error) {
        report.errors += 1; errors += 1;
        errorRows.push({ rowNumber: row.rowNumber, studentCod: studentCodes.join(',') || null, reason: error.message });
      }
      processed += 1; progress.render({ processed, ok, invalid, errors });
    }

    progress.render({ processed, ok, invalid, errors, force: true }); progress.finish();
    await applyCandidates({ candidates, report, success: enrollmentSuccessRows, skipped: enrollmentSkippedRows, errors: enrollmentErrorRows });
    const logsDir = ensureLogsDir();
    fs.writeFileSync(path.join(logsDir, 'import-tutors-success.json'), JSON.stringify(successRows, null, 2), 'utf8');
    fs.writeFileSync(path.join(logsDir, 'import-tutors-errors.json'), JSON.stringify(errorRows, null, 2), 'utf8');
    fs.writeFileSync(path.join(logsDir, 'import-tutors-skipped.json'), JSON.stringify(skippedRows, null, 2), 'utf8');
    fs.writeFileSync(path.join(logsDir, 'import-tutors-enrollments-success.json'), JSON.stringify(enrollmentSuccessRows, null, 2), 'utf8');
    fs.writeFileSync(path.join(logsDir, 'import-tutors-enrollments-skipped.json'), JSON.stringify(enrollmentSkippedRows, null, 2), 'utf8');
    fs.writeFileSync(path.join(logsDir, 'import-tutors-enrollments-errors.json'), JSON.stringify(enrollmentErrorRows, null, 2), 'utf8');
    console.log('===== Import Tutors + Enrollments Summary =====');
    console.log(`Total filas: ${report.totalRows}`);
    console.log(`Filas invalidas: ${report.rowsInvalid}`);
    console.log(`Omitidos: ${report.skipped}`);
    console.log(`Errores de proceso: ${report.errors}`);
    console.log(`Warnings: ${report.warnings}`);
    console.log(`People creadas: ${report.peopleCreated}`);
    console.log(`People actualizadas: ${report.peopleUpdated}`);
    console.log(`Tutores creados: ${report.tutorsCreated}`);
    console.log(`Tutores actualizados: ${report.tutorsUpdated}`);
    console.log(`Vinculos tutor-alumno procesados: ${report.tutorLinksProcessed}`);
    console.log(`StudentCod sin alumno: ${report.missingStudents}`);
    console.log(`Matriculas creadas: ${report.enrollmentsCreated}`);
    console.log(`Matriculas actualizadas: ${report.enrollmentsUpdated}`);
    console.log(`EnrollmentStudents creados: ${report.enrollmentStudentsCreated}`);
    console.log(`EnrollmentStudents actualizados: ${report.enrollmentStudentsUpdated}`);
    console.log(`Cargos creados: ${report.chargesCreated}`);
    console.log(`Matriculas omitidas: ${report.enrollmentSkipped}`);
    console.log(`Errores creando/modificando matriculas: ${report.enrollmentErrors}`);
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
