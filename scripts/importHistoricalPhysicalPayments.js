import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';

import { connectDB } from '../src/config/db.js';
import { Student } from '../src/models/student.model.js';
import { Person } from '../src/models/person.model.js';
import { User } from '../src/models/user.model.js';
import { Campus } from '../src/models/campus.model.js';
import { Cycle } from '../src/models/cycle.model.js';
import { Classroom } from '../src/models/classroom.model.js';
import { Vacancy } from '../src/models/vacancy.model.js';
import { Charge } from '../src/models/charge.model.js';
import { Payment } from '../src/models/payment.model.js';
import { PaymentAllocation } from '../src/models/paymentAllocation.model.js';
import { BillingConcept } from '../src/models/billingConcept.model.js';
import { Counter } from '../src/models/counter.model.js';

const DEFAULT_FILE = './data/pagos.csv';
const PAYMENT_DATE = new Date('2026-03-22T19:00:00-05:00');
const BOOKS_DESCRIPTION = 'Libros';

const COLUMN_DEFS = [
  { key: 'books', type: 'books', chargeHeader: 'libros', amountHeader: 'librosmonto', codeHeader: 'libroscod', conceptCode: 'SCHOOL_BOOKS', description: BOOKS_DESCRIPTION },
  { key: 'admission', type: 'existing', amountHeader: 'ingresomonto', codeHeader: 'ingresocod', conceptCode: 'ADMISSION_FEE', concept: 'ADMISSION', description: 'Derecho de ingreso' },
  { key: 'enrollment', type: 'existing', amountHeader: 'matriculamonto', codeHeader: 'matriculacod', conceptCode: 'ENROLLMENT_FEE', concept: 'ENROLLMENT', description: 'Matricula' },
  { key: 'marzo', type: 'existing', amountHeader: 'marzomonto', codeHeader: 'marzocod', conceptCode: 'TUITION', concept: 'TUITION', monthIndex: 0, description: 'Pension - Marzo' },
  { key: 'abril', type: 'existing', amountHeader: 'abrilmonto', codeHeader: 'abrilcod', conceptCode: 'TUITION', concept: 'TUITION', monthIndex: 1, description: 'Pension - Abril' },
  { key: 'mayo', type: 'existing', amountHeader: 'mayomonto', codeHeader: 'mayocod', conceptCode: 'TUITION', concept: 'TUITION', monthIndex: 2, description: 'Pension - Mayo' },
  { key: 'junio', type: 'existing', amountHeader: 'juniomonto', codeHeader: 'juniocod', conceptCode: 'TUITION', concept: 'TUITION', monthIndex: 3, description: 'Pension - Junio' },
  { key: 'julio', type: 'existing', amountHeader: 'juliomonto', codeHeader: 'juliocod', conceptCode: 'TUITION', concept: 'TUITION', monthIndex: 4, description: 'Pension - Julio' },
  { key: 'agosto', type: 'existing', amountHeader: 'agostomonto', codeHeader: 'agostocod', conceptCode: 'TUITION', concept: 'TUITION', monthIndex: 5, description: 'Pension - Agosto' },
  { key: 'septiembre', type: 'existing', amountHeader: 'septiembremonto', codeHeader: 'septiembrecod', conceptCode: 'TUITION', concept: 'TUITION', monthIndex: 6, description: 'Pension - Septiembre' },
  { key: 'octubre', type: 'existing', amountHeader: 'octubremonto', codeHeader: 'octubrecod', conceptCode: 'TUITION', concept: 'TUITION', monthIndex: 7, description: 'Pension - Octubre' },
  { key: 'noviembre', type: 'existing', amountHeader: 'noviembremonto', codeHeader: 'noviembrecod', conceptCode: 'TUITION', concept: 'TUITION', monthIndex: 8, description: 'Pension - Noviembre' },
  { key: 'diciembre', type: 'existing', amountHeader: 'diciembremonto', codeHeader: 'diciembrecod', conceptCode: 'TUITION', concept: 'TUITION', monthIndex: 9, description: 'Pension - Diciembre' },
];

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
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

function parseCSV(content) {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];

  const headerLine = lines[0];
  const counts = [
    ['\t', (headerLine.match(/\t/g) || []).length],
    [',', (headerLine.match(/,/g) || []).length],
    [';', (headerLine.match(/;/g) || []).length],
  ].sort((a, b) => b[1] - a[1]);
  const delimiter = counts[0][0];
  const headers = headerLine.split(delimiter).map(normalizeHeader);

  return lines.slice(1).map((line, index) => {
    const values = line.split(delimiter).map((value) => String(value || '').trim());
    const raw = {};
    headers.forEach((header, valueIndex) => {
      raw[header] = values[valueIndex] || '';
    });
    return { rowNumber: index + 2, raw };
  });
}

function norm(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function ensureLogsDir() {
  const dir = path.resolve(process.cwd(), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function decimal(value) {
  return mongoose.Types.Decimal128.fromString(Number(value).toFixed(2));
}

function toMoney(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value.toString());
}

function normalizeReceiptNumber(value) {
  const digits = String(value || '').replace(/\D/g, '').trim();
  if (!digits) return null;
  if (digits.length > 6) return null;
  return digits.padStart(6, '0');
}

function formatDurationMs(ms) {
  const totalSeconds = Math.floor(Math.max(0, ms || 0) / 1000);
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
      if (!force && processed !== total && processed % step !== 0) return;
      const elapsed = Date.now() - startedAt;
      const avg = processed > 0 ? elapsed / processed : 0;
      const eta = processed > 0 ? Math.max(0, (total - processed) * avg) : 0;
      const line = `\r${Math.floor((processed / total) * 100)}% (${processed}/${total}) | ok:${ok} invalid:${invalid} errors:${errors} | elapsed:${formatDurationMs(elapsed)} ETA:${formatDurationMs(eta)}`;
      process.stdout.write(line + ' '.repeat(Math.max(0, lastLineLength - line.length)));
      lastLineLength = line.length;
      hasRendered = true;
    },
    finish() {
      if (!quiet && hasRendered) console.log('');
    },
  };
}

function extractCodeSequence(value) {
  const match = String(value || '').match(/^PAY-(\d+)$/i);
  return match ? Number(match[1]) : 0;
}

async function resolveNextPaymentSequence() {
  const [payments, counter] = await Promise.all([
    Payment.find({ internalCode: /^PAY-\d+$/i }).select('internalCode').lean(),
    Counter.findOne({ key: 'payment_internal_code' }).lean(),
  ]);

  const maxPaymentSeq = payments.reduce((max, row) => Math.max(max, extractCodeSequence(row.internalCode)), 0);
  const counterSeq = Number(counter?.seq || 0);

  return Math.max(maxPaymentSeq, counterSeq);
}

function nextPaymentInternalCode(state) {
  state.current += 1;
  return `PAY-${String(state.current).padStart(6, '0')}`;
}

function buildRow(raw) {
  return {
    internalCode: norm(raw.internalcode),
    level: norm(raw.nivel),
    grade: norm(raw.grado),
    section: norm(raw.seccion),
    lastNames: norm(raw.apellidos),
    names: norm(raw.nombres),
    campus: norm(raw.sede),
    observations: norm(raw.observaciones),
    values: raw,
  };
}

function parseMultiValueCell(raw) {
  const text = norm(raw);
  if (!text) return { kind: 'EMPTY', values: [] };
  if (text.toUpperCase().includes('EXO')) return { kind: 'EXO', values: [] };

  const tokens = text.split(/\s*-\s*/).map((item) => norm(item)).filter(Boolean);
  if (!tokens.length) return { kind: 'EMPTY', values: [] };

  return { kind: 'VALUES', values: tokens };
}

function parseAmountsAndCodes(amountRaw, codeRaw) {
  const amountTokens = parseMultiValueCell(amountRaw);
  const codeTokens = parseMultiValueCell(codeRaw);

  if (amountTokens.kind === 'EXO' || codeTokens.kind === 'EXO') {
    return { kind: 'EXO', items: [] };
  }

  if (amountTokens.kind === 'EMPTY' && codeTokens.kind === 'EMPTY') {
    return { kind: 'EMPTY', items: [] };
  }

  if (amountTokens.kind === 'EMPTY' || codeTokens.kind === 'EMPTY') {
    return { kind: 'INVALID', reason: 'Monto y codigo deben existir juntos', items: [] };
  }

  if (amountTokens.values.length !== codeTokens.values.length) {
    return { kind: 'INVALID', reason: 'Cantidad de montos y codigos no coincide', items: [] };
  }

  const items = [];
  for (let index = 0; index < amountTokens.values.length; index += 1) {
    const amountToken = amountTokens.values[index];
    const codeToken = codeTokens.values[index];
    const amount = Number(String(amountToken).replace(',', '.'));
    const receiptNumber = normalizeReceiptNumber(codeToken);

    if (!Number.isFinite(amount) || amount <= 0) {
      return { kind: 'INVALID', reason: `Monto invalido: ${amountToken}`, items: [] };
    }

    if (!receiptNumber) {
      return { kind: 'INVALID', reason: `Codigo de recibo invalido: ${codeToken}`, items: [] };
    }

    items.push({ amount, receiptNumber, rawCode: codeToken });
  }

  return { kind: 'VALUES', items };
}

function parseBooksCharge(raw) {
  const cell = parseMultiValueCell(raw);
  if (cell.kind === 'EXO') return { kind: 'EXO', amount: null };
  if (cell.kind === 'EMPTY') return { kind: 'EMPTY', amount: null };

  if (cell.values.length !== 1) {
    return { kind: 'INVALID', reason: 'Libros debe tener un solo monto de cargo' };
  }

  const amount = Number(String(cell.values[0]).replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) {
    return { kind: 'INVALID', reason: `Monto de cargo de libros invalido: ${cell.values[0]}` };
  }

  return { kind: 'VALUE', amount };
}

async function resolveSystemUser() {
  const preferredEmails = ['admin_all@cienciasperu.edu.pe', 'admin@cienciasperu.edu.pe'];
  for (const email of preferredEmails) {
    const user = await User.findOne({ email, isActive: true }).select('_id email').lean();
    if (user) return user;
  }

  const fallback = await User.findOne({ roles: 'ADMIN', isActive: true }).select('_id email').lean();
  if (!fallback) {
    throw new Error('No se encontro un usuario ADMIN activo para registrar createdByUserId');
  }
  return fallback;
}

async function resolveActiveCycle() {
  const now = new Date();
  const activeCycle = await Cycle.findOne({
    type: 'SCHOOL_YEAR',
    isActive: true,
    startDate: { $lte: now },
    endDate: { $gte: now },
  }).sort({ startDate: -1 }).lean();

  if (activeCycle) return activeCycle;

  const fallback = await Cycle.findOne({ type: 'SCHOOL_YEAR', isActive: true }).sort({ startDate: -1 }).lean();
  if (!fallback) throw new Error('No existe un ciclo escolar activo');
  return fallback;
}

async function buildStudentContextMap(cycleId) {
  const students = await Student.find({}).select('_id internalCode personId').lean();
  const studentIds = students.map((row) => row._id);
  const vacancies = await Vacancy.find({ cycleId, studentId: { $in: studentIds } }).select('studentId classroomId').lean();
  const classroomIds = [...new Set(vacancies.map((row) => String(row.classroomId || '')).filter(Boolean))]
    .map((id) => new mongoose.Types.ObjectId(id));
  const classrooms = classroomIds.length
    ? await Classroom.find({ _id: { $in: classroomIds } }).select('_id campusId displayName level grade section').lean()
    : [];
  const campusIds = [...new Set(classrooms.map((row) => String(row.campusId || '')).filter(Boolean))]
    .map((id) => new mongoose.Types.ObjectId(id));
  const campuses = campusIds.length
    ? await Campus.find({ _id: { $in: campusIds } }).select('_id code name').lean()
    : [];
  const people = await Person.find({ _id: { $in: students.map((row) => row.personId).filter(Boolean) } })
    .select('_id names lastNames')
    .lean();

  const classroomById = new Map(classrooms.map((row) => [String(row._id), row]));
  const campusById = new Map(campuses.map((row) => [String(row._id), row]));
  const personById = new Map(people.map((row) => [String(row._id), row]));
  const vacancyByStudentId = new Map(vacancies.map((row) => [String(row.studentId), row]));

  return new Map(students.map((student) => {
    const vacancy = vacancyByStudentId.get(String(student._id)) || null;
    const classroom = vacancy ? classroomById.get(String(vacancy.classroomId)) : null;
    const campus = classroom ? campusById.get(String(classroom.campusId)) : null;
    const person = personById.get(String(student.personId)) || null;
    return [student.internalCode, {
      ...student,
      person,
      classroom,
      campus,
    }];
  }));
}

async function resolveBillingConceptMap() {
  const concepts = await BillingConcept.find({
    code: { $in: ['ADMISSION_FEE', 'ENROLLMENT_FEE', 'TUITION', 'SCHOOL_BOOKS'] },
  }).select('_id code name').lean();
  return new Map(concepts.map((row) => [row.code, row]));
}

function buildChargeKey(charge) {
  const conceptId = String(charge.conceptId?._id || charge.conceptId || '');
  const concept = String(charge.concept || '');
  const monthIndex = charge.monthIndex === null || charge.monthIndex === undefined ? 'null' : String(charge.monthIndex);
  return `${conceptId}::${concept}::${monthIndex}`;
}

async function findStudentChargesMap(studentId, cycleId) {
  const charges = await Charge.find({
    studentId,
    cycleId,
    status: { $ne: 'CANCELLED' },
  })
    .populate('conceptId', 'code name')
    .sort({ dueDate: 1, _id: 1 })
    .lean();

  const map = new Map();
  for (const charge of charges) {
    const key = buildChargeKey(charge);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(charge);
  }
  return map;
}

function buildExpectedChargeKey({ conceptDoc, concept, monthIndex }) {
  const conceptId = String(conceptDoc?._id || '');
  const monthPart = monthIndex === null || monthIndex === undefined ? 'null' : String(monthIndex);
  return `${conceptId}::${concept || ''}::${monthPart}`;
}

async function findExistingPaymentByReceipt(receiptNumber) {
  return Payment.findOne({ receiptNumber }).select('_id internalCode receiptNumber').lean();
}

async function cancelChargeCompletely(chargeId, session) {
  const allocationExists = await PaymentAllocation.exists({ chargeId }).session(session);
  if (allocationExists) {
    return { deleted: false, reason: 'El cargo ya tiene pagos aplicados' };
  }

  await Charge.deleteOne({ _id: chargeId }, { session });
  return { deleted: true };
}

async function createBooksChargeIfNeeded({
  studentContext,
  cycle,
  concept,
  booksChargeAmount,
  existingCharge,
  report,
  booksChargeRows,
}) {
  if (!booksChargeAmount || booksChargeAmount.kind !== 'VALUE') return existingCharge || null;
  if (existingCharge) return existingCharge;

  if (!studentContext?.campus?._id) {
    report.errors += 1;
    return null;
  }

  const charge = await Charge.create({
    studentId: studentContext._id,
    cycleId: cycle._id,
    campusId: studentContext.campus._id,
    conceptId: concept._id,
    description: BOOKS_DESCRIPTION,
    totalAmount: decimal(booksChargeAmount.amount),
    outstandingAmount: decimal(booksChargeAmount.amount),
    dueDate: PAYMENT_DATE,
    status: 'OPEN',
    notes: 'Cargo creado por importacion de pagos fisicos',
  });

  const createdCharge = await Charge.findById(charge._id).populate('conceptId', 'code name').lean();
  booksChargeRows.push({
    studentCode: studentContext.internalCode,
    studentName: `${studentContext.person?.lastNames || ''}, ${studentContext.person?.names || ''}`.replace(/^,\s*/, '').trim(),
    chargeId: String(createdCharge._id),
    amount: booksChargeAmount.amount,
  });
  report.booksChargesCreated += 1;
  return createdCharge;
}

async function createPaymentForCharge({
  paymentSequence,
  createdByUserId,
  studentContext,
  charge,
  paymentItem,
}) {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const freshCharge = await Charge.findById(charge._id).session(session);
    if (!freshCharge) throw new Error('Cargo no encontrado al aplicar pago');

    const outstanding = toMoney(freshCharge.outstandingAmount);
    if (paymentItem.amount > outstanding + 0.0001) {
      throw new Error(`El monto ${paymentItem.amount} excede el saldo pendiente ${outstanding}`);
    }

    const internalCode = nextPaymentInternalCode(paymentSequence);

    const payment = await Payment.create([{
      studentId: studentContext._id,
      studentIds: [studentContext._id],
      campusId: freshCharge.campusId,
      paidAt: PAYMENT_DATE,
      totalAmount: decimal(paymentItem.amount),
      method: 'CASH',
      internalCode,
      receiptNumber: paymentItem.receiptNumber,
      voucherNumber: internalCode,
      createdByUserId,
      notes: 'Importado desde pagos.csv',
    }], { session }).then((docs) => docs[0]);

    await PaymentAllocation.create([{
      paymentId: payment._id,
      chargeId: freshCharge._id,
      amount: decimal(paymentItem.amount),
    }], { session });

    const nextOutstanding = Math.max(0, outstanding - paymentItem.amount);
    const nextStatus = nextOutstanding <= 0 ? 'PAID' : 'PARTIAL';

    await Charge.updateOne(
      { _id: freshCharge._id },
      {
        $set: {
          outstandingAmount: decimal(nextOutstanding),
          status: nextStatus,
        },
      },
      { session }
    );

    await session.commitTransaction();
    return {
      paymentId: String(payment._id),
      internalCode,
      receiptNumber: paymentItem.receiptNumber,
      amount: paymentItem.amount,
      chargeId: String(freshCharge._id),
    };
  } catch (error) {
    await session.abortTransaction();
    paymentSequence.current -= 1;
    throw error;
  } finally {
    await session.endSession();
  }
}

async function syncPaymentCounter(sequence) {
  await Counter.findOneAndUpdate(
    { key: 'payment_internal_code' },
    { $set: { seq: sequence.current } },
    { upsert: true }
  );
}

async function run() {
  const args = parseArgs(process.argv);
  const quiet = Boolean(args.quiet);
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
    processed: 0,
    errors: 0,
    studentsNotFound: 0,
    paymentsCreated: 0,
    booksChargesCreated: 0,
    chargesExonerated: 0,
  };

  const successRows = [];
  const skippedRows = [];
  const errorRows = [];
  const exoneratedRows = [];
  const booksChargeRows = [];

  try {
    const [systemUser, activeCycle, billingConceptMap, nextSequenceValue] = await Promise.all([
      resolveSystemUser(),
      resolveActiveCycle(),
      resolveBillingConceptMap(),
      resolveNextPaymentSequence(),
    ]);

    const missingConcepts = ['ADMISSION_FEE', 'ENROLLMENT_FEE', 'TUITION', 'SCHOOL_BOOKS']
      .filter((code) => !billingConceptMap.has(code));
    if (missingConcepts.length) {
      throw new Error(`Faltan BillingConcept requeridos: ${missingConcepts.join(', ')}`);
    }

    const studentContextMap = await buildStudentContextMap(activeCycle._id);
    const paymentSequence = { current: nextSequenceValue };

    if (!quiet) {
      console.log(`Archivo origen: ${selectedFile}`);
      console.log(`Ciclo activo: ${activeCycle.name} (${activeCycle.year})`);
      console.log(`Usuario de importacion: ${systemUser.email}`);
      console.log(`Secuencia inicial de pagos: PAY-${String(paymentSequence.current + 1).padStart(6, '0')}`);
    }

    const rows = parseCSV(fs.readFileSync(filePath, 'utf8'));
    report.totalRows = rows.length;
    const progress = createProgressTracker({ scriptName: 'importHistoricalPhysicalPayments', total: rows.length, quiet });

    let processed = 0;
    let ok = 0;
    let invalid = 0;
    let errors = 0;

    for (const row of rows) {
      const mapped = buildRow(row.raw);
      processed += 1;
      report.processed = processed;

      if (!mapped.internalCode) {
        report.rowsInvalid += 1;
        invalid += 1;
        errorRows.push({ rowNumber: row.rowNumber, reason: 'internalCode vacio' });
        progress.render({ processed, ok, invalid, errors });
        continue;
      }

      const studentContext = studentContextMap.get(mapped.internalCode);
      if (!studentContext) {
        report.studentsNotFound += 1;
        skippedRows.push({
          rowNumber: row.rowNumber,
          studentCode: mapped.internalCode,
          studentName: `${mapped.lastNames}, ${mapped.names}`.replace(/^,\s*/, '').trim(),
          reason: 'Alumno no encontrado por internalCode',
        });
        ok += 1;
        progress.render({ processed, ok, invalid, errors });
        continue;
      }

      let studentChargeMap = await findStudentChargesMap(studentContext._id, activeCycle._id);

      for (const columnDef of COLUMN_DEFS) {
        const chargeCell = columnDef.type === 'books' ? parseBooksCharge(row.raw[columnDef.chargeHeader]) : null;
        const paymentCell = parseAmountsAndCodes(row.raw[columnDef.amountHeader], row.raw[columnDef.codeHeader]);

        if (chargeCell?.kind === 'INVALID') {
          report.errors += 1;
          errors += 1;
          errorRows.push({
            rowNumber: row.rowNumber,
            studentCode: mapped.internalCode,
            studentName: `${studentContext.person?.lastNames || ''}, ${studentContext.person?.names || ''}`.replace(/^,\s*/, '').trim(),
            column: columnDef.key,
            reason: chargeCell.reason,
          });
          continue;
        }

        if (paymentCell.kind === 'INVALID') {
          report.errors += 1;
          errors += 1;
          errorRows.push({
            rowNumber: row.rowNumber,
            studentCode: mapped.internalCode,
            studentName: `${studentContext.person?.lastNames || ''}, ${studentContext.person?.names || ''}`.replace(/^,\s*/, '').trim(),
            column: columnDef.key,
            reason: paymentCell.reason,
          });
          continue;
        }

        const conceptDoc = billingConceptMap.get(columnDef.conceptCode);
        const expectedKey = buildExpectedChargeKey({
          conceptDoc,
          concept: columnDef.concept || '',
          monthIndex: columnDef.monthIndex,
        });

        let candidateCharges = studentChargeMap.get(expectedKey) || [];
        if (columnDef.type === 'books' && !candidateCharges.length) {
          const booksFallback = Array.from(studentChargeMap.values())
            .flat()
            .filter((charge) => String(charge.description || '').trim().toLowerCase() === BOOKS_DESCRIPTION.toLowerCase());
          candidateCharges = booksFallback;
        }

        if (candidateCharges.length > 1) {
          skippedRows.push({
            rowNumber: row.rowNumber,
            studentCode: mapped.internalCode,
            studentName: `${studentContext.person?.lastNames || ''}, ${studentContext.person?.names || ''}`.replace(/^,\s*/, '').trim(),
            column: columnDef.key,
            reason: 'Se encontraron multiples cargos candidatos para el mismo concepto',
          });
          continue;
        }

        let charge = candidateCharges[0] || null;

        if (chargeCell?.kind === 'EXO' || paymentCell.kind === 'EXO') {
          if (!charge) continue;

          const session = await mongoose.startSession();
          try {
            session.startTransaction();
            const result = await cancelChargeCompletely(charge._id, session);
            if (!result.deleted) {
              throw new Error(result.reason);
            }
            await session.commitTransaction();
            report.chargesExonerated += 1;
            exoneratedRows.push({
              rowNumber: row.rowNumber,
              studentCode: mapped.internalCode,
              studentName: `${studentContext.person?.lastNames || ''}, ${studentContext.person?.names || ''}`.replace(/^,\s*/, '').trim(),
              column: columnDef.key,
              chargeId: String(charge._id),
              concept: charge.description || columnDef.description,
            });
            studentChargeMap = await findStudentChargesMap(studentContext._id, activeCycle._id);
          } catch (error) {
            await session.abortTransaction();
            report.errors += 1;
            errors += 1;
            errorRows.push({
              rowNumber: row.rowNumber,
              studentCode: mapped.internalCode,
              studentName: `${studentContext.person?.lastNames || ''}, ${studentContext.person?.names || ''}`.replace(/^,\s*/, '').trim(),
              column: columnDef.key,
              reason: `No se pudo exonerar/borrar el cargo: ${error.message}`,
            });
          } finally {
            await session.endSession();
          }
          continue;
        }

        if (columnDef.type === 'books') {
          charge = await createBooksChargeIfNeeded({
            studentContext,
            cycle: activeCycle,
            concept: conceptDoc,
            booksChargeAmount: chargeCell,
            existingCharge: charge,
            report,
            booksChargeRows,
          });
          if (charge) {
            studentChargeMap = await findStudentChargesMap(studentContext._id, activeCycle._id);
            candidateCharges = studentChargeMap.get(expectedKey) || [charge];
            charge = candidateCharges[0] || charge;
          }
        }

        if (paymentCell.kind !== 'VALUES' || !paymentCell.items.length) {
          continue;
        }

        if (!charge) {
          skippedRows.push({
            rowNumber: row.rowNumber,
            studentCode: mapped.internalCode,
            studentName: `${studentContext.person?.lastNames || ''}, ${studentContext.person?.names || ''}`.replace(/^,\s*/, '').trim(),
            column: columnDef.key,
            reason: 'Existe pago en el CSV pero no existe el cargo correspondiente',
          });
          continue;
        }

        for (const item of paymentCell.items) {
          const existingPayment = await findExistingPaymentByReceipt(item.receiptNumber);
          if (existingPayment) {
            skippedRows.push({
              rowNumber: row.rowNumber,
              studentCode: mapped.internalCode,
              studentName: `${studentContext.person?.lastNames || ''}, ${studentContext.person?.names || ''}`.replace(/^,\s*/, '').trim(),
              column: columnDef.key,
              reason: `Ya existe un pago con recibo ${item.receiptNumber}`,
              existingPaymentCode: existingPayment.internalCode,
            });
            continue;
          }

          try {
            const created = await createPaymentForCharge({
              paymentSequence,
              createdByUserId: systemUser._id,
              studentContext,
              charge,
              paymentItem: item,
            });
            report.paymentsCreated += 1;
            successRows.push({
              rowNumber: row.rowNumber,
              studentCode: mapped.internalCode,
              studentName: `${studentContext.person?.lastNames || ''}, ${studentContext.person?.names || ''}`.replace(/^,\s*/, '').trim(),
              column: columnDef.key,
              paymentId: created.paymentId,
              internalCode: created.internalCode,
              receiptNumber: created.receiptNumber,
              amount: created.amount,
              chargeId: created.chargeId,
            });

            charge = await Charge.findById(charge._id).populate('conceptId', 'code name').lean();
          } catch (error) {
            report.errors += 1;
            errors += 1;
            errorRows.push({
              rowNumber: row.rowNumber,
              studentCode: mapped.internalCode,
              studentName: `${studentContext.person?.lastNames || ''}, ${studentContext.person?.names || ''}`.replace(/^,\s*/, '').trim(),
              column: columnDef.key,
              reason: error.message,
              receiptNumber: item.receiptNumber,
              amount: item.amount,
            });
          }
        }

        studentChargeMap = await findStudentChargesMap(studentContext._id, activeCycle._id);
      }

      ok += 1;
      progress.render({ processed, ok, invalid, errors });
    }

    progress.render({ processed, ok, invalid, errors, force: true });
    progress.finish();

    await syncPaymentCounter(paymentSequence);

    const logsDir = ensureLogsDir();
    fs.writeFileSync(path.join(logsDir, 'import-physical-payments-success.json'), JSON.stringify(successRows, null, 2), 'utf8');
    fs.writeFileSync(path.join(logsDir, 'import-physical-payments-errors.json'), JSON.stringify(errorRows, null, 2), 'utf8');
    fs.writeFileSync(path.join(logsDir, 'import-physical-payments-skipped.json'), JSON.stringify(skippedRows, null, 2), 'utf8');
    fs.writeFileSync(path.join(logsDir, 'import-physical-payments-exonerated.json'), JSON.stringify(exoneratedRows, null, 2), 'utf8');
    fs.writeFileSync(path.join(logsDir, 'import-physical-payments-books-charges.json'), JSON.stringify(booksChargeRows, null, 2), 'utf8');

    console.log('===== Import Historical Physical Payments Summary =====');
    console.log(`Total filas: ${report.totalRows}`);
    console.log(`Filas invalidas: ${report.rowsInvalid}`);
    console.log(`Pagos creados: ${report.paymentsCreated}`);
    console.log(`Cargos de libros creados: ${report.booksChargesCreated}`);
    console.log(`Cargos exonerados/borrados: ${report.chargesExonerated}`);
    console.log(`Alumnos no encontrados: ${report.studentsNotFound}`);
    console.log(`Errores: ${report.errors}`);
    console.log(`Secuencia final: PAY-${String(paymentSequence.current).padStart(6, '0')}`);
    console.log(`Logs: ${logsDir}`);
    process.exit(0);
  } catch (error) {
    console.error('Error ejecutando importHistoricalPhysicalPayments:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
}

run();
