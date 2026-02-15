import mongoose from 'mongoose';
import { AuditLog } from '../models/auditLog.model.js';

export async function registerAuditLog({ entityType, entityId, action, performedBy, campusId, payloadSnapshot = {} }) {
  try {
    await AuditLog.create({
      entityType,
      entityId: mongoose.Types.ObjectId.isValid(entityId) ? new mongoose.Types.ObjectId(entityId) : entityId,
      action,
      performedBy,
      campusId,
      payloadSnapshot,
    });
  } catch (error) {
    console.error('[audit] failed to persist audit log', {
      entityType,
      entityId,
      action,
      error: error?.message,
    });
  }
}
