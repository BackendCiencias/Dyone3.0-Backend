import mongoose from 'mongoose';

const billingScheduleSchema = new mongoose.Schema({
  cycleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cycle', required: true },
  conceptCode: {
    type: String,
    required: [true, 'conceptCode es obligatorio'],
    uppercase: true,
    trim: true,
  },
  monthIndex: { type: Number, min: 0, max: 9, default: null },
  label: { type: String, trim: true, default: '' },
  dueDate: { type: Date, required: true },
}, { timestamps: true });

billingScheduleSchema.index({ cycleId: 1, conceptCode: 1, monthIndex: 1 }, { unique: true });

export const BillingSchedule = mongoose.model('BillingSchedule', billingScheduleSchema);
