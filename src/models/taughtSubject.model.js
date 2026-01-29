import mongoose from 'mongoose';

const taughtSubjectSchema = new mongoose.Schema({
  classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', required: true },
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  cycleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cycle', required: true },
  campusId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campus', required: true },
  teacherPersonId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true },
  startDate: { type: Date, default: Date.now },
  endDate: { type: Date },
  notes: { type: String },
});

export const TaughtSubject = mongoose.model('TaughtSubject', taughtSubjectSchema);