import mongoose from 'mongoose';

const attendanceMonthlySummarySchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  campusId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campus', required: true, index: true },
  cycleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cycle', required: true, index: true },
  classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', default: null, index: true },
  year: { type: Number, required: true, index: true },
  month: { type: Number, required: true, index: true },
  presentCount: { type: Number, default: 0 },
  lateCount: { type: Number, default: 0 },
  absentCount: { type: Number, default: 0 },
  justifiedLateCount: { type: Number, default: 0 },
  justifiedAbsentCount: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

attendanceMonthlySummarySchema.index({ studentId: 1, year: 1, month: 1, classroomId: 1 }, { unique: true });
attendanceMonthlySummarySchema.index({ campusId: 1, cycleId: 1, classroomId: 1, year: 1, month: 1 });
attendanceMonthlySummarySchema.index({ studentId: 1, year: 1, month: 1 });

export const AttendanceMonthlySummary = mongoose.model('AttendanceMonthlySummary', attendanceMonthlySummarySchema);
