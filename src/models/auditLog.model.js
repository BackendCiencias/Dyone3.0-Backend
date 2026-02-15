import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  entityType: {
    type: String,
    enum: ['ENROLLMENT', 'PAYMENT', 'CLASSROOM_CHANGE', 'TRANSFER', 'CHARGE'],
    required: true,
  },
  entityId: { type: mongoose.Schema.Types.ObjectId, required: true },
  action: { type: String, required: true },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  campusId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campus' },
  payloadSnapshot: { type: Object, default: {} },
  createdAt: { type: Date, default: Date.now },
});

auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
