import mongoose from 'mongoose';

const attendanceSessionSchema = new mongoose.Schema({
  campusId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campus', required: true },
  classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom' },
  date: { type: Date, required: true },
  type: { type: String, enum: ['REGULAR', 'AFTERNOON_5TH', 'PARENTS_MEETING', 'MATH_CLUB'], required: true },
  startTime: { type: String },
  lateTime: { type: String },
  notes: { type: String },
});

export const AttendanceSession = mongoose.model('AttendanceSession', attendanceSessionSchema);