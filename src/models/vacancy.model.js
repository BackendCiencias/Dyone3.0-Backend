import mongoose from 'mongoose';

const vacancySchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  cycleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cycle', required: true },
  classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', required: true },
  startDate: { type: Date, default: Date.now },
  endDate: { type: Date },
  notes: { type: String },
});

export const Vacancy = mongoose.model('Vacancy', vacancySchema);