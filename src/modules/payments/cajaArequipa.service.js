import crypto from 'crypto';
import zlib from 'zlib';
import { Campus } from '../../models/campus.model.js';
import { Charge } from '../../models/charge.model.js';
import { Cycle } from '../../models/cycle.model.js';
import { Student } from '../../models/student.model.js';
import { Payment } from '../../models/payment.model.js';
import { PaymentAllocation } from '../../models/paymentAllocation.model.js';
import { CajaArequipaImportSession } from '../../models/cajaArequipaImportSession.model.js';
import { CajaArequipaImportedRow } from '../../models/cajaArequipaImportedRow.model.js';
import { ApiError } from '../../utils/errors.js';
import { createPaymentService } from './payments.service.js';
import { getEnrollmentContextForStudent } from '../../shared/enrollmentCurrent.js';

const MONTH_LABELS = {
  3: { label: 'Marzo', monthIndex: 0 },
  4: { label: 'Abril', monthIndex: 1 },
  5: { label: 'Mayo', monthIndex: 2 },
  6: { label: 'Junio', monthIndex: 3 },
  7: { label: 'Julio', monthIndex: 4 },
  8: { label: 'Agosto', monthIndex: 5 },
  9: { label: 'Septiembre', monthIndex: 6 },
  10: { label: 'Octubre', monthIndex: 7 },
  11: { label: 'Noviembre', monthIndex: 8 },
  12: { label: 'Diciembre', monthIndex: 9 },
};

const REVIEW_STATUS = {
  READY: 'READY_TO_IMPORT',
  DUPLICATE: 'DUPLICATE',
  PAYMENT_WEB: 'PAYMENT_WEB',
  MANUAL_REVIEW: 'MANUAL_REVIEW',
  STUDENT_NOT_FOUND: 'STUDENT_NOT_FOUND',
  CHARGE_NOT_FOUND: 'CHARGE_NOT_FOUND',
  IMPORTED: 'IMPORTED',
};

function toMoney(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value.toString());
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function getScopedCampusCodes(campusScope = []) {
  if (!Array.isArray(campusScope)) return [];
  return campusScope.map((value) => String(value || '').trim().toUpperCase()).filter(Boolean);
}

async function resolveCampusCode({ requestedCampus, campusScope = [] }) {
  const normalizedRequested = String(requestedCampus || '').trim().toUpperCase();
  const scope = getScopedCampusCodes(campusScope);
  const scopeAll = scope.includes('ALL');

  if (normalizedRequested) {
    if (!scopeAll && scope.length && !scope.includes(normalizedRequested)) {
      throw new ApiError(403, 'No autorizado para procesar ese campus');
    }
    const campus = await Campus.findOne({ code: normalizedRequested }).select('_id code name').lean();
    if (!campus) throw new ApiError(404, 'Campus no encontrado');
    return campus.code;
  }

  if (!scopeAll) {
    const scopedCodes = scope.filter((code) => code !== 'ALL');
    if (scopedCodes.length === 1) return scopedCodes[0];
  }

  throw new ApiError(400, 'Debes especificar el campus para procesar el PDF');
}

function decodePdfString(raw) {
  if (!raw) return '';
  return raw
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\n/g, ' ')
    .replace(/\\r/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\b/g, '')
    .replace(/\\f/g, '')
    .replace(/\\\\/g, '\\')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPdfTextLines(buffer) {
  const streams = [];
  let cursor = 0;
  while ((cursor = buffer.indexOf(Buffer.from('stream'), cursor)) !== -1) {
    const lineBreakStart = buffer.indexOf(Buffer.from('\n'), cursor);
    const start = lineBreakStart >= 0 ? lineBreakStart + 1 : -1;
    const end = start >= 0 ? buffer.indexOf(Buffer.from('endstream'), start) : -1;
    if (start < 0 || end <= start) {
      cursor += 6;
      continue;
    }

    let chunk = buffer.subarray(start, end);
    if (chunk[0] === 0x0d && chunk[1] === 0x0a) chunk = chunk.subarray(2);
    else if (chunk[0] === 0x0a || chunk[0] === 0x0d) chunk = chunk.subarray(1);

    try {
      const inflated = zlib.inflateSync(chunk).toString('latin1');
      if (/Tj|TJ/.test(inflated)) streams.push(inflated);
    } catch {
      // Ignorar streams no textuales o no comprimidos con Flate.
    }

    cursor = end + 9;
  }

  const lines = [];
  const joined = streams.join('\n');
  const pushLine = (raw) => {
    const decoded = decodePdfString(raw);
    if (decoded) lines.push(decoded);
  };

  for (const match of joined.matchAll(/\(([^()]*(?:\\.[^()]*)*)\)\s*Tj/g)) {
    pushLine(match[1]);
  }

  for (const match of joined.matchAll(/\[((?:.|\r|\n)*?)\]\s*TJ/g)) {
    for (const segment of match[1].matchAll(/\(([^()]*(?:\\.[^()]*)*)\)/g)) {
      pushLine(segment[1]);
    }
  }

  return lines;
}

function isAmount(value) {
  return /^-?\d+(?:\.\d{2})$/.test(String(value || '').trim());
}

function isBankCode(value) {
  return /^\d{8,14}$/.test(String(value || '').trim());
}

function isReceipt(value) {
  return /^\d{6,14}$/.test(String(value || '').trim());
}

function parseDdMmYy(raw) {
  const match = String(raw || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!match) return null;
  const [, dd, mm, yy] = match;
  const year = 2000 + Number(yy);
  return new Date(Date.UTC(year, Number(mm) - 1, Number(dd), 12, 0, 0));
}

function detectInstitution(lines = []) {
  return lines.find((line) => /(EDUCAMAT|CIENCIAS PERU|E\.I\.R\.L|EIRL)/i.test(line) && !/CAJA MUNICIPAL/i.test(line)) || null;
}

function parseSubperiod(subperiod) {
  const match = String(subperiod || '').match(/SUBPERIODO\s+(\d{4})(\d{2})/i);
  if (!match) return { periodYear: null, monthNumber: null, monthIndex: null, monthLabel: null };
  const periodYear = Number(match[1]);
  const monthNumber = Number(match[2]);
  const monthMeta = MONTH_LABELS[monthNumber] || {};
  return {
    periodYear,
    monthNumber,
    monthIndex: Number.isInteger(monthMeta.monthIndex) ? monthMeta.monthIndex : null,
    monthLabel: monthMeta.label || null,
  };
}

function buildImportFingerprint(row) {
  const source = [
    String(row.institution || '').trim().toUpperCase(),
    row.paidAt ? new Date(row.paidAt).toISOString().slice(0, 10) : '',
    String(row.bankCode || '').trim(),
    String(row.subperiod || '').trim().toUpperCase(),
    roundMoney(row.reportedAmount || 0).toFixed(2),
    String(row.receiptNumber || '').trim(),
  ].join('|');

  return crypto.createHash('sha256').update(source).digest('hex');
}

function parseCajaArequipaRows(buffer, fileName = '') {
  const lines = extractPdfTextLines(buffer);
  const institution = detectInstitution(lines) || String(fileName || '').replace(/\.pdf$/i, '').trim() || null;
  const rows = [];
  let currentDate = null;
  let currentOperator = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (line === '*Fecha') {
      currentDate = lines[i + 1] || currentDate;
      i += 1;
      continue;
    }

    if (line === '**Operador') {
      currentOperator = lines[i + 1] || currentOperator;
      i += 1;
      continue;
    }

    if (!isAmount(line) || !isAmount(lines[i + 1])) continue;

    const mora = roundMoney(lines[i]);
    const reportedAmount = roundMoney(lines[i + 1]);
    const classification = lines[i + 2] || '';
    const repeatedAmount = lines[i + 3] || '';
    const bankCode = lines[i + 4] || '';
    const pdfStudentName = lines[i + 5] || '';
    const receiptNumber = lines[i + 6] || '';
    const nextLine = lines[i + 7] || '';
    const nextNextLine = lines[i + 8] || '';

    if (!classification || !isAmount(repeatedAmount) || !isBankCode(bankCode) || !pdfStudentName.includes(',') || !isReceipt(receiptNumber)) {
      continue;
    }

    let establishment = '';
    let subperiod = '';
    let consumed = 0;

    if (/^SUBPERIODO\s+\d{6}$/i.test(nextLine)) {
      subperiod = nextLine;
      consumed = 8;
    } else if (nextLine && /^SUBPERIODO\s+\d{6}$/i.test(nextNextLine)) {
      establishment = nextLine;
      subperiod = nextNextLine;
      consumed = 9;
    } else {
      continue;
    }

    rows.push({
      institution,
      paidAt: parseDdMmYy(currentDate),
      paidAtRaw: currentDate,
      operator: currentOperator || null,
      establishment: establishment || null,
      bankCode,
      pdfStudentName,
      classification,
      receiptNumber,
      subperiod,
      reportedAmount,
      moraAmount: mora,
    });

    i += consumed - 1;
  }

  return rows;
}

async function resolveChargeForStudent({ studentId, campusId, periodYear, monthIndex }) {
  if (!Number.isInteger(monthIndex) || !periodYear) return null;

  const charges = await Charge.find({
    studentId,
    campusId,
    concept: 'TUITION',
    monthIndex,
    status: { $ne: 'CANCELLED' },
  })
    .populate('cycleId', 'year isActive name')
    .lean();

  if (!charges.length) return null;

  const sameYear = charges.filter((charge) => Number(charge.cycleId?.year) === Number(periodYear));
  if (!sameYear.length) return null;

  const sorted = sameYear.sort((a, b) => {
    const activeRank = Number(Boolean(b.cycleId?.isActive)) - Number(Boolean(a.cycleId?.isActive));
    if (activeRank !== 0) return activeRank;
    return String(a._id).localeCompare(String(b._id));
  });

  return sorted[0];
}

async function hasExistingPaymentForCharge(chargeId) {
  const allocation = await PaymentAllocation.findOne({ chargeId })
    .populate('paymentId', 'paidAt totalAmount voucherNumber receiptNumber internalCode')
    .lean();

  return allocation?.paymentId || null;
}

async function classifyCajaArequipaRow({ rawRow, campusCode, importedFingerprints = new Set(), seenFingerprints = new Set() }) {
  const period = parseSubperiod(rawRow.subperiod);
  const baseRow = {
    institution: rawRow.institution,
    paidAt: rawRow.paidAt,
    operator: rawRow.operator,
    establishment: rawRow.establishment,
    isWebPayment: !String(rawRow.establishment || '').trim(),
    bankCode: rawRow.bankCode,
    pdfStudentName: rawRow.pdfStudentName,
    classification: rawRow.classification,
    receiptNumber: rawRow.receiptNumber,
    subperiod: rawRow.subperiod,
    periodYear: period.periodYear,
    monthNumber: period.monthNumber,
    monthIndex: period.monthIndex,
    monthLabel: period.monthLabel,
    reportedAmount: roundMoney(rawRow.reportedAmount),
    expectedTuitionAmount: 0,
    commissionAmount: 0,
    moraAmount: roundMoney(rawRow.moraAmount),
    studentId: null,
    studentCode: null,
    studentFullName: null,
    chargeId: null,
    chargeLabel: null,
    chargeOutstandingAmount: 0,
    observation: null,
    reviewStatus: REVIEW_STATUS.MANUAL_REVIEW,
    paymentId: null,
    importedAt: null,
  };

  const fingerprint = buildImportFingerprint(baseRow);
  baseRow.fingerprint = fingerprint;

  if (importedFingerprints.has(fingerprint)) {
    return {
      ...baseRow,
      reviewStatus: REVIEW_STATUS.DUPLICATE,
      observation: 'La fila ya fue importada antes desde Caja Arequipa.',
    };
  }

  if (seenFingerprints.has(fingerprint)) {
    return {
      ...baseRow,
      reviewStatus: REVIEW_STATUS.DUPLICATE,
      observation: 'La fila se repite dentro del mismo PDF.',
    };
  }
  seenFingerprints.add(fingerprint);

  const student = await Student.findOne({
    $or: [
      { bankCode: rawRow.bankCode },
      { legacyBankCodes: rawRow.bankCode },
    ],
  })
    .populate('personId', 'names lastNames')
    .select('_id internalCode bankCode legacyBankCodes personId')
    .lean();

  if (!student) {
    return {
      ...baseRow,
      reviewStatus: REVIEW_STATUS.STUDENT_NOT_FOUND,
      observation: 'No se encontro un alumno con ese codigo Caja Arequipa.',
    };
  }

  const enrollmentContext = await getEnrollmentContextForStudent(student._id);
  const studentCampusCode = String(enrollmentContext?.campus?.code || '').trim().toUpperCase();
  if (!studentCampusCode || studentCampusCode !== campusCode) {
    return {
      ...baseRow,
      studentId: student._id,
      studentCode: student.internalCode || null,
      studentFullName: [student.personId?.lastNames, student.personId?.names].filter(Boolean).join(', ') || rawRow.pdfStudentName,
      reviewStatus: REVIEW_STATUS.MANUAL_REVIEW,
      observation: 'El alumno existe pero no coincide con el campus seleccionado.',
    };
  }

  const charge = await resolveChargeForStudent({
    studentId: student._id,
    campusId: enrollmentContext?.campus?._id,
    periodYear: period.periodYear,
    monthIndex: period.monthIndex,
  });

  if (!charge) {
    return {
      ...baseRow,
      studentId: student._id,
      studentCode: student.internalCode || null,
      studentFullName: [student.personId?.lastNames, student.personId?.names].filter(Boolean).join(', ') || rawRow.pdfStudentName,
      reviewStatus: REVIEW_STATUS.CHARGE_NOT_FOUND,
      observation: 'No se encontro el cargo de pension del mes detectado en la web.',
    };
  }

  const expectedTuitionAmount = roundMoney(toMoney(charge.totalAmount));
  const chargeOutstandingAmount = roundMoney(toMoney(charge.outstandingAmount));
  const existingPayment = await hasExistingPaymentForCharge(charge._id);
  const commissionAmount = Math.max(0, roundMoney(rawRow.reportedAmount - expectedTuitionAmount));

  const nextRow = {
    ...baseRow,
    expectedTuitionAmount,
    commissionAmount,
    studentId: student._id,
    studentCode: student.internalCode || null,
    studentFullName: [student.personId?.lastNames, student.personId?.names].filter(Boolean).join(', ') || rawRow.pdfStudentName,
    chargeId: charge._id,
    chargeLabel: charge.description || `Pension - ${period.monthLabel || 'Mes'}`,
    chargeOutstandingAmount,
  };

  if (nextRow.isWebPayment) {
    if (existingPayment || chargeOutstandingAmount <= 0) {
      return {
        ...nextRow,
        reviewStatus: REVIEW_STATUS.PAYMENT_WEB,
        paymentId: existingPayment?._id || null,
        observation: 'Pago web ya presente en la web. No se importara de nuevo.',
      };
    }

    return {
      ...nextRow,
      reviewStatus: REVIEW_STATUS.MANUAL_REVIEW,
      observation: 'Pago web no hallado en la web, revisar manualmente.',
    };
  }

  if (chargeOutstandingAmount <= 0) {
    return {
      ...nextRow,
      reviewStatus: REVIEW_STATUS.DUPLICATE,
      paymentId: existingPayment?._id || null,
      observation: 'El cargo ya figura cancelado en la web.',
    };
  }

  if (Math.abs(chargeOutstandingAmount - expectedTuitionAmount) > 0.01) {
    return {
      ...nextRow,
      reviewStatus: REVIEW_STATUS.MANUAL_REVIEW,
      observation: 'El cargo tiene un saldo parcial o distinto al monto base esperado.',
    };
  }

  if (rawRow.reportedAmount + 0.01 < expectedTuitionAmount) {
    return {
      ...nextRow,
      reviewStatus: REVIEW_STATUS.MANUAL_REVIEW,
      observation: 'El total reportado es menor al monto base de pension registrado en la web.',
    };
  }

  return {
    ...nextRow,
    reviewStatus: REVIEW_STATUS.READY,
    observation: commissionAmount > 0
      ? 'Fila lista para importar. El excedente se mostrara como comision bancaria.'
      : 'Fila lista para importar.',
  };
}

function buildSummary(rows = []) {
  const summary = {
    processedRows: rows.length,
    readyToImport: 0,
    duplicated: 0,
    paymentWeb: 0,
    manualReview: 0,
    studentsNotFound: 0,
    chargesNotFound: 0,
    totalReportedAmount: 0,
    totalExpectedTuitionAmount: 0,
    totalCommissionAmount: 0,
    totalMoraAmount: 0,
  };

  for (const row of rows) {
    summary.totalReportedAmount = roundMoney(summary.totalReportedAmount + roundMoney(row.reportedAmount));
    summary.totalExpectedTuitionAmount = roundMoney(summary.totalExpectedTuitionAmount + roundMoney(row.expectedTuitionAmount));
    summary.totalCommissionAmount = roundMoney(summary.totalCommissionAmount + roundMoney(row.commissionAmount));
    summary.totalMoraAmount = roundMoney(summary.totalMoraAmount + roundMoney(row.moraAmount));

    if (row.reviewStatus === REVIEW_STATUS.READY) summary.readyToImport += 1;
    else if (row.reviewStatus === REVIEW_STATUS.DUPLICATE) summary.duplicated += 1;
    else if (row.reviewStatus === REVIEW_STATUS.PAYMENT_WEB) summary.paymentWeb += 1;
    else if (row.reviewStatus === REVIEW_STATUS.MANUAL_REVIEW) summary.manualReview += 1;
    else if (row.reviewStatus === REVIEW_STATUS.STUDENT_NOT_FOUND) summary.studentsNotFound += 1;
    else if (row.reviewStatus === REVIEW_STATUS.CHARGE_NOT_FOUND) summary.chargesNotFound += 1;
  }

  return summary;
}

function sanitizeReviewSession(session) {
  return {
    importId: String(session._id),
    campusCode: session.campusCode,
    fileName: session.fileName,
    status: session.status,
    summary: session.summary || {},
    errorMessage: session.errorMessage || null,
    createdAt: session.createdAt,
    confirmedAt: session.confirmedAt || null,
    rows: Array.isArray(session.rows) ? session.rows.map((row) => ({
      ...row,
      studentId: row.studentId ? String(row.studentId) : null,
      chargeId: row.chargeId ? String(row.chargeId) : null,
      paymentId: row.paymentId ? String(row.paymentId) : null,
    })) : [],
  };
}

async function assertSessionCampusAllowed(session, campusScope = []) {
  const scoped = getScopedCampusCodes(campusScope);
  if (!scoped.includes('ALL') && scoped.length && !scoped.includes(String(session.campusCode || '').toUpperCase())) {
    throw new ApiError(403, 'No autorizado para revisar esa importacion');
  }
}

export async function processCajaArequipaPdfService({ fileName, pdfBase64, campus, campusScope = [], requestedByUserId }) {
  const campusCode = await resolveCampusCode({ requestedCampus: campus, campusScope });
  const normalizedBase64 = String(pdfBase64 || '').trim();
  if (!normalizedBase64) throw new ApiError(400, 'Debes enviar el PDF en base64');

  const safeBase64 = normalizedBase64.includes(',') ? normalizedBase64.split(',').pop() : normalizedBase64;
  const buffer = Buffer.from(safeBase64, 'base64');
  if (!buffer.length) throw new ApiError(400, 'No se pudo decodificar el PDF');

  const pdfHash = crypto.createHash('sha256').update(buffer).digest('hex');
  const [session] = await CajaArequipaImportSession.create([{
    campusCode,
    requestedByUserId,
    fileName: fileName || 'caja-arequipa.pdf',
    pdfHash,
    status: 'PROCESSING',
    summary: {},
    rows: [],
  }]);

  try {
    const rawRows = parseCajaArequipaRows(buffer, fileName);
    const importedRows = await CajaArequipaImportedRow.find({ fingerprint: { $in: rawRows.map((row) => buildImportFingerprint({
      institution: row.institution,
      paidAt: row.paidAt,
      bankCode: row.bankCode,
      subperiod: row.subperiod,
      reportedAmount: row.reportedAmount,
      receiptNumber: row.receiptNumber,
    })) } }).select('fingerprint').lean();
    const importedFingerprints = new Set(importedRows.map((row) => row.fingerprint));
    const seenFingerprints = new Set();

    const rows = [];
    for (let index = 0; index < rawRows.length; index += 1) {
      const classified = await classifyCajaArequipaRow({
        rawRow: rawRows[index],
        campusCode,
        importedFingerprints,
        seenFingerprints,
      });
      rows.push({
        rowIndex: index + 1,
        ...classified,
      });
    }

    session.status = 'READY';
    session.rows = rows;
    session.summary = buildSummary(rows);
    session.errorMessage = null;
    await session.save();
  } catch (error) {
    session.status = 'FAILED';
    session.errorMessage = error instanceof Error ? error.message : 'No se pudo procesar el PDF';
    await session.save();
    throw error;
  }

  return {
    importId: String(session._id),
    status: session.status,
  };
}

export async function getCajaArequipaReviewService({ importId, campusScope = [] }) {
  const session = await CajaArequipaImportSession.findById(importId).lean();
  if (!session) throw new ApiError(404, 'Importacion no encontrada');
  await assertSessionCampusAllowed(session, campusScope);
  return sanitizeReviewSession(session);
}

export async function confirmCajaArequipaImportService({ importId, campusScope = [], userId }) {
  const session = await CajaArequipaImportSession.findById(importId);
  if (!session) throw new ApiError(404, 'Importacion no encontrada');
  await assertSessionCampusAllowed(session, campusScope);

  if (session.status === 'FAILED') {
    throw new ApiError(400, 'La importacion fallo y no puede confirmarse');
  }

  const result = {
    imported: 0,
    duplicated: 0,
    paymentWeb: 0,
    manualReview: 0,
    logs: [],
  };

  for (const row of session.rows) {
    if (row.reviewStatus === REVIEW_STATUS.DUPLICATE || row.reviewStatus === REVIEW_STATUS.IMPORTED) {
      result.duplicated += 1;
      result.logs.push({ rowIndex: row.rowIndex, status: 'duplicada', observation: row.observation });
      continue;
    }

    if (row.reviewStatus === REVIEW_STATUS.PAYMENT_WEB) {
      result.paymentWeb += 1;
      result.logs.push({ rowIndex: row.rowIndex, status: 'pago_web', observation: row.observation });
      continue;
    }

    if (row.reviewStatus !== REVIEW_STATUS.READY) {
      result.manualReview += 1;
      result.logs.push({ rowIndex: row.rowIndex, status: 'revision_manual', observation: row.observation });
      continue;
    }

    const alreadyImported = await CajaArequipaImportedRow.findOne({ fingerprint: row.fingerprint }).lean();
    if (alreadyImported) {
      row.reviewStatus = REVIEW_STATUS.DUPLICATE;
      row.paymentId = alreadyImported.paymentId;
      row.observation = 'La fila ya fue importada en una confirmacion anterior.';
      result.duplicated += 1;
      result.logs.push({ rowIndex: row.rowIndex, status: 'duplicada', observation: row.observation });
      continue;
    }

    const charge = await Charge.findById(row.chargeId).lean();
    if (!charge || roundMoney(toMoney(charge.outstandingAmount)) <= 0) {
      row.reviewStatus = REVIEW_STATUS.DUPLICATE;
      row.observation = 'El cargo ya no tiene saldo pendiente al confirmar.';
      result.duplicated += 1;
      result.logs.push({ rowIndex: row.rowIndex, status: 'duplicada', observation: row.observation });
      continue;
    }

    const payment = await createPaymentService({
      campusId: charge.campusId,
      studentId: row.studentId,
      amount: roundMoney(row.expectedTuitionAmount),
      paidAt: row.paidAt ? new Date(row.paidAt).toISOString() : new Date().toISOString(),
      method: 'CAJA_AREQUIPA',
      voucherNumber: row.receiptNumber,
      allocations: [{ chargeId: String(row.chargeId), amount: roundMoney(row.expectedTuitionAmount) }],
      notes: [
        'Importado desde Caja Arequipa',
        row.subperiod ? `Periodo ${row.subperiod}` : null,
        row.establishment ? `Establecimiento: ${row.establishment}` : 'Pago web/operador sin establecimiento',
        row.operator ? `Operador: ${row.operator}` : null,
        row.commissionAmount > 0 ? `Comision: S/ ${roundMoney(row.commissionAmount).toFixed(2)}` : null,
        row.moraAmount > 0 ? `Mora: S/ ${roundMoney(row.moraAmount).toFixed(2)}` : null,
      ].filter(Boolean).join(' · '),
      idempotencyKey: `caja-arequipa:${row.fingerprint}`,
      createdByUserId: userId,
    });

    await CajaArequipaImportedRow.create({
      fingerprint: row.fingerprint,
      importSessionId: session._id,
      paymentId: payment.payment._id,
      campusCode: session.campusCode,
      institution: row.institution,
      bankCode: row.bankCode,
      receiptNumber: row.receiptNumber,
      subperiod: row.subperiod,
      paidAt: row.paidAt,
      reportedAmount: roundMoney(row.reportedAmount),
      commissionAmount: roundMoney(row.commissionAmount),
      moraAmount: roundMoney(row.moraAmount),
    });

    row.reviewStatus = REVIEW_STATUS.IMPORTED;
    row.paymentId = payment.payment._id;
    row.importedAt = new Date();
    row.observation = 'Pago importado correctamente.';
    result.imported += 1;
    result.logs.push({ rowIndex: row.rowIndex, status: 'importada', paymentId: String(payment.payment._id) });
  }

  session.summary = {
    ...buildSummary(session.rows),
    imported: result.imported,
    duplicatedOnConfirm: result.duplicated,
    paymentWebOnConfirm: result.paymentWeb,
    manualReviewOnConfirm: result.manualReview,
  };
  session.status = 'CONFIRMED';
  session.confirmedAt = new Date();
  await session.save();

  return {
    importId: String(session._id),
    imported: result.imported,
    duplicated: result.duplicated,
    paymentWeb: result.paymentWeb,
    manualReview: result.manualReview,
    logs: result.logs,
  };
}
