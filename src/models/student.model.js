import mongoose from 'mongoose';

const studentSchema = new mongoose.Schema(
  {
    personId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true, index: true },

    internalCode: { type: String, required: true, unique: true, index: true },

    bankCode: { type: String, unique: true, sparse: true, index: true, trim: true },
    previousCampus: { type: String, trim: true },

    activeStatus: { type: String, enum: ['ACTIVE', 'INACTIVE', 'GRADUATED'], default: 'ACTIVE', index: true },
    entryDate: { type: Date },
    notes: { type: String },
    internalNotes: { type: String },
  },
  { timestamps: true }
);

studentSchema.index({ personId: 1 }, { unique: true });
studentSchema.index({ _id: 1 });

export const Student = mongoose.model('Student', studentSchema);
