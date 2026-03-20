import mongoose from 'mongoose';

const attendancePolicySchema = new mongoose.Schema({
  scopeType: {
    type: String,
    enum: ['REGULAR_STUDENT', 'PROGRAM_STUDENT', 'TEACHER'],
    required: true,
    index: true,
  },
  campusId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campus', required: true, index: true },
  cycleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cycle', default: null, index: true },
  level: { type: String, enum: ['INITIAL', 'PRIMARY', 'SECONDARY'], default: null, index: true },
  classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', default: null, index: true },
  programId: { type: mongoose.Schema.Types.ObjectId, ref: 'Program', default: null, index: true },
  name: { type: String, required: true },
  defaultOnTimeUntil: { type: String, required: true },
  daysOfWeek: { type: [Number], default: [] },
  isActive: { type: Boolean, default: true, index: true },
  notes: { type: String, default: null },
  createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

attendancePolicySchema.index({ scopeType: 1, campusId: 1, cycleId: 1, level: 1, classroomId: 1, programId: 1, isActive: 1 });
attendancePolicySchema.index({ campusId: 1, cycleId: 1, level: 1, isActive: 1 });

export const AttendancePolicy = mongoose.model('AttendancePolicy', attendancePolicySchema);
