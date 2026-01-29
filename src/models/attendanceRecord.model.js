import mongoose from 'mongoose';

const attendanceRecordSchema = new mongoose.Schema({
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'AttendanceSession', required: true },
  personId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true },
  status: { type: String, enum: ['PRESENT', 'LATE', 'ABSENT', 'JUSTIFIED'], required: true },
  markedAt: { type: Date, default: Date.now },
  method: { type: String, enum: ['BARCODE', 'MANUAL'], required: true },
  notes: { type: String },
});

export const AttendanceRecord = mongoose.model('AttendanceRecord', attendanceRecordSchema);