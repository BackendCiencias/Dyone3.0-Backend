import mongoose from 'mongoose';

const schoolCalendarDaySchema = new mongoose.Schema({
  campusId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campus', required: true },
  cycleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cycle', required: true },
  date: { type: Date, required: true },
  type: { type: String, enum: ['SCHOOL_DAY', 'HOLIDAY', 'SUSPENDED'], required: true },
  description: { type: String },
  notes: { type: String },
});

// Índice para evitar duplicados de fechas por sede y ciclo
schoolCalendarDaySchema.index({ campusId: 1, cycleId: 1, date: 1 }, { unique: true });

export const SchoolCalendarDay = mongoose.model('SchoolCalendarDay', schoolCalendarDaySchema);