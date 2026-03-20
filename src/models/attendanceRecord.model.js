import mongoose from 'mongoose';

const attendanceRecordSchema = new mongoose.Schema({
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'AttendanceSession', required: true, index: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  studentCycleId: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentCycle', required: true, index: true },
  personId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', default: null },
  status: { type: String, enum: ['PRESENT', 'LATE', 'ABSENT'], required: true, index: true },
  arrivalTime: { type: String, default: null },
  markMethod: { type: String, enum: ['MANUAL', 'BARCODE', 'BULK'], required: true },
  markedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  markedAt: { type: Date, required: true, default: Date.now, index: true },
  justificationStatus: { type: String, enum: ['NONE', 'JUSTIFIED'], default: 'NONE' },
  justificationType: { type: String, enum: ['LATE', 'ABSENT'], default: null },
  justificationReason: { type: String, default: null },
  justifiedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  justifiedAt: { type: Date, default: null },
  notes: { type: String, default: null },
}, { timestamps: true });

attendanceRecordSchema.index({ sessionId: 1, studentId: 1 }, { unique: true });
attendanceRecordSchema.index({ studentId: 1, createdAt: 1 });
attendanceRecordSchema.index({ studentCycleId: 1, createdAt: 1 });
attendanceRecordSchema.index({ sessionId: 1, markedAt: -1 });
attendanceRecordSchema.index({ sessionId: 1, status: 1 });

export const AttendanceRecord = mongoose.model('AttendanceRecord', attendanceRecordSchema);
