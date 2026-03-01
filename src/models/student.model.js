import mongoose from 'mongoose';

const studentSchema = new mongoose.Schema(
  {
    personId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true, index: true },
    familyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Family', index: true },

    internalCode: { type: String, required: true, unique: true, index: true },

    bankCode: { type: String, unique: true, sparse: true, index: true, trim: true },

    isActive: { type: Boolean, default: true },
    entryDate: { type: Date },
    notes: { type: String },
    internalNotes: { type: String },
  },
  { timestamps: true }
);

studentSchema.index({ personId: 1 }, { unique: true });
studentSchema.index({ familyId: 1 });
studentSchema.index({ _id: 1 });

export const Student = mongoose.model('Student', studentSchema);
