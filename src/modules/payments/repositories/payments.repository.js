import { PaymentRequestLog } from '../../../models/paymentRequestLog.model.js';

export async function findPaymentRequestByKey(idempotencyKey, session = null) {
  const query = PaymentRequestLog.findOne({ idempotencyKey });
  if (session) query.session(session);
  return query.lean();
}

export async function createPaymentRequestLog({ idempotencyKey, paymentId }, session) {
  const [row] = await PaymentRequestLog.create([{ idempotencyKey, paymentId }], { session });
  return row;
}
