import mongoose from 'mongoose';

const attendanceSessionSchema = new mongoose.Schema({
  scopeType: {
    type: String,
    enum: ['REGULAR_STUDENT', 'PROGRAM_STUDENT', 'TEACHER'],
    required: true,
    index: true,
  },
  campusId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campus', required: true, index: true },
  cycleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cycle', required: true, index: true },
  classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', default: null, index: true },
  programId: { type: mongoose.Schema.Types.ObjectId, ref: 'Program', default: null, index: true },
  programSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProgramSession', default: null, index: true },
  schoolCalendarDayId: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolCalendarDay', default: null },
  date: { type: Date, required: true, index: true },
  expectedStartTime: { type: String, required: true },
  onTimeUntil: { type: String, required: true },
  lateUntil: { type: String, default: null },
  status: {
    type: String,
    enum: ['OPEN', 'CLOSED', 'CANCELLED'],
    default: 'OPEN',
    index: true,
  },
  attendancePolicyId: { type: mongoose.Schema.Types.ObjectId, ref: 'AttendancePolicy', default: null },
  takenByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  openedAt: { type: Date, required: true, default: Date.now },
  closedAt: { type: Date, default: null },
  notes: { type: String, default: null },
}, { timestamps: true });

attendanceSessionSchema.index(
  { scopeType: 1, campusId: 1, cycleId: 1, classroomId: 1, programId: 1, programSessionId: 1, date: 1 },
  { unique: true }
);
attendanceSessionSchema.index({ campusId: 1, date: 1 });
attendanceSessionSchema.index({ status: 1, date: 1 });

export const AttendanceSession = mongoose.model('AttendanceSession', attendanceSessionSchema);
