import mongoose from 'mongoose';

const { Schema } = mongoose;

const activityParticipantSchema = new Schema(
  {
    activityId: { type: Schema.Types.ObjectId, ref: 'Activity', required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    status: {
      type: String,
      enum: ['PENDING', 'PAID', 'ANULADO'],
      default: 'PENDING',
      index: true,
    },
    registeredByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    registeredByRole: { type: String, required: true, trim: true, uppercase: true },
    registeredAt: { type: Date, default: Date.now },
    paidAt: { type: Date, default: null },
    latestCollectionId: { type: Schema.Types.ObjectId, ref: 'ActivityCollection', default: null },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

activityParticipantSchema.index({ activityId: 1, studentId: 1 }, { unique: true });

export const ActivityParticipant = mongoose.model('ActivityParticipant', activityParticipantSchema);
