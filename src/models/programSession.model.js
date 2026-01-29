import mongoose from 'mongoose';

const programSessionSchema = new mongoose.Schema({
  programId: { type: mongoose.Schema.Types.ObjectId, ref: 'Program', required: true },
  date: { type: Date, required: true },
  wasHeld: { type: Boolean, default: false },
  notes: { type: String },
});

export const ProgramSession = mongoose.model('ProgramSession', programSessionSchema);