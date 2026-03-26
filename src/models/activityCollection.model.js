import mongoose from 'mongoose';

const { Schema } = mongoose;

const activityCollectionSchema = new Schema(
  {
    activityId: { type: Schema.Types.ObjectId, ref: 'Activity', required: true, index: true },
    participantId: { type: Schema.Types.ObjectId, ref: 'ActivityParticipant', required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    campusId: { type: Schema.Types.ObjectId, ref: 'Campus', required: true, index: true },
    collectorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    collectorRole: { type: String, required: true, trim: true, uppercase: true, index: true },
    amount: { type: Schema.Types.Decimal128, required: true },
    method: {
      type: String,
      enum: ['CASH', 'YAPE', 'TRANSFER'],
      required: true,
      default: 'CASH',
    },
    collectedAt: { type: Date, required: true, default: Date.now },
    receiptInternalCode: { type: String, required: true, trim: true, unique: true, index: true },
    notes: { type: String, trim: true },
    isVoided: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

activityCollectionSchema.index({ activityId: 1, collectorUserId: 1, createdAt: -1 });

export const ActivityCollection = mongoose.model('ActivityCollection', activityCollectionSchema);
