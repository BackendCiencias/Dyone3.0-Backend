import mongoose from 'mongoose';

const { Schema } = mongoose;

const activitySchema = new Schema(
  {
    campusId: { type: Schema.Types.ObjectId, ref: 'Campus', required: true, index: true },
    cycleId: { type: Schema.Types.ObjectId, ref: 'Cycle', required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
    type: {
      type: String,
      enum: ['CONTEST', 'EVENT', 'CAMPAIGN', 'SPECIAL_COLLECTION'],
      default: 'SPECIAL_COLLECTION',
      index: true,
    },
    description: { type: String, trim: true },
    audienceType: {
      type: String,
      enum: ['LEVEL', 'GRADE', 'CLASSROOMS', 'CUSTOM'],
      required: true,
      index: true,
    },
    targetLevel: {
      type: String,
      enum: ['INITIAL', 'PRIMARY', 'SECONDARY', null],
      default: null,
    },
    targetGrade: { type: Number, default: null },
    classroomIds: [{ type: Schema.Types.ObjectId, ref: 'Classroom' }],
    amount: { type: Schema.Types.Decimal128, required: true },
    status: {
      type: String,
      enum: ['ACTIVE', 'CLOSED', 'LIQUIDATED'],
      default: 'ACTIVE',
      index: true,
    },
    allowSecretaryCollection: { type: Boolean, default: true },
    allowAuxiliarCollection: { type: Boolean, default: true },
    allowAdminCollection: { type: Boolean, default: true },
    receiptSeries: { type: String, default: 'ACT', trim: true, uppercase: true },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

activitySchema.index({ campusId: 1, status: 1, createdAt: -1 });

export const Activity = mongoose.model('Activity', activitySchema);
