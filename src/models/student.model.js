import mongoose from 'mongoose';

const studentSchema = new mongoose.Schema(
  {
    personId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true, index: true },
    familyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Family', required: true, index: true },

    internalCode: { type: String, required: true, unique: true, index: true },

    isActive: { type: Boolean, default: true },
    entryDate: { type: Date },
    notes: { type: String },
  },
  { timestamps: true }
);

studentSchema.index({ personId: 1 }, { unique: true });

export const Student = mongoose.model('Student', studentSchema);
