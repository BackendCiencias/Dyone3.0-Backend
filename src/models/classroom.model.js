import mongoose from 'mongoose';

const classroomSchema = new mongoose.Schema({
  campusId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campus', required: true },
  cycleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cycle', required: true },
  level: { type: String, enum: ['INITIAL', 'PRIMARY', 'SECONDARY'], required: true },
  grade: { type: String, required: true },
  section: { type: String, required: true },
  capacity: { type: Number, required: true },
  displayName: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  notes: { type: String },
});

// Índice para asegurar que no haya duplicados por sede, ciclo, grado y sección
classroomSchema.index({ campusId: 1, cycleId: 1, grade: 1, section: 1 }, { unique: true });

export const Classroom = mongoose.model('Classroom', classroomSchema);