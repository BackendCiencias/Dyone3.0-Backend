import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { Payment } from '../src/models/payment.model.js';
import { AuditLog } from '../src/models/auditLog.model.js';

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

function getTodayInLima() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return formatter.format(new Date());
}

function assertDateString(value) {
  const normalized = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`Fecha inválida: ${value}. Usa YYYY-MM-DD`);
  }
  return normalized;
}

function buildUtcDayRange(dateString) {
  const start = new Date(`${dateString}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '');
  return date.toISOString();
}

async function run() {
  const args = parseArgs(process.argv);
  const targetDate = assertDateString(args.date || getTodayInLima());
  const apply = parseBooleanFlag(args.apply);
  const quiet = parseBooleanFlag(args.quiet);
  const { start, end } = buildUtcDayRange(targetDate);

  await connectDB();

  const report = {
    targetDate,
    mode: apply ? 'apply' : 'dry-run',
    candidates: 0,
    updated: 0,
    skippedWithoutAudit: 0,
    skippedSameTimestamp: 0,
    skippedAuditOutOfRange: 0,
    rows: [],
  };

  try {
    const payments = await Payment.find({
      paidAt: { $gte: start, $lt: end },
    })
      .sort({ paidAt: 1, _id: 1 })
      .lean();

    report.candidates = payments.length;

    if (!quiet) {
      console.log(`Fecha objetivo: ${targetDate}`);
      console.log(`Modo: ${report.mode}`);
      console.log(`Pagos candidatos: ${payments.length}`);
    }

    for (const payment of payments) {
      const paidAt = new Date(payment.paidAt);
      const isExactUtcMidnight = (
        paidAt.getUTCHours() === 0
        && paidAt.getUTCMinutes() === 0
        && paidAt.getUTCSeconds() === 0
        && paidAt.getUTCMilliseconds() === 0
      );

      if (!isExactUtcMidnight) continue;

      const audit = await AuditLog.findOne({
        entityType: 'PAYMENT',
        entityId: payment._id,
        action: 'PAYMENT_CREATED',
      })
        .sort({ createdAt: -1, _id: -1 })
        .lean();

      if (!audit?.createdAt) {
        report.skippedWithoutAudit += 1;
        report.rows.push({
          paymentId: String(payment._id),
          internalCode: payment.internalCode || null,
          status: 'skipped_without_audit',
          previousPaidAt: formatDate(payment.paidAt),
        });
        continue;
      }

      const auditCreatedAt = new Date(audit.createdAt);
      if (Number.isNaN(auditCreatedAt.getTime())) {
        report.skippedWithoutAudit += 1;
        report.rows.push({
          paymentId: String(payment._id),
          internalCode: payment.internalCode || null,
          status: 'skipped_invalid_audit_date',
          previousPaidAt: formatDate(payment.paidAt),
        });
        continue;
      }

      const sameTimestamp = paidAt.getTime() === auditCreatedAt.getTime();
      if (sameTimestamp) {
        report.skippedSameTimestamp += 1;
        report.rows.push({
          paymentId: String(payment._id),
          internalCode: payment.internalCode || null,
          status: 'skipped_same_timestamp',
          previousPaidAt: formatDate(payment.paidAt),
          nextPaidAt: formatDate(auditCreatedAt),
        });
        continue;
      }

      const row = {
        paymentId: String(payment._id),
        internalCode: payment.internalCode || null,
        status: apply ? 'updated' : 'would_update',
        previousPaidAt: formatDate(payment.paidAt),
        nextPaidAt: formatDate(auditCreatedAt),
        auditLogId: String(audit._id),
      };

      report.rows.push(row);

      if (apply) {
        await Payment.updateOne(
          { _id: payment._id },
          { $set: { paidAt: auditCreatedAt } }
        );
        report.updated += 1;
      }
    }

    if (!quiet) {
      console.log('===== Fix Payment paidAt Summary =====');
      console.log(`Candidatos: ${report.candidates}`);
      console.log(`Actualizados: ${report.updated}`);
      console.log(`Sin audit log: ${report.skippedWithoutAudit}`);
      console.log(`Ya estaban iguales: ${report.skippedSameTimestamp}`);
    }
  } finally {
    await mongoose.connection.close();
  }
}

run().catch((error) => {
  console.error('Error ejecutando fixPaymentPaidAtFromAudit:', error);
  process.exit(1);
});
