import { Payment } from '../../models/payment.model.js';

export async function findPaymentCampusById(paymentId) {
  const row = await Payment.findById(paymentId).select('campusId').lean();
  return row?.campusId || null;
}
