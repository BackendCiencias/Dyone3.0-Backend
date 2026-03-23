import { Enrollment } from '../../../models/enrollment.model.js';
import { Campus } from '../../../models/campus.model.js';

export async function findEnrollmentCampusById(enrollmentId) {
  const row = await Enrollment.findById(enrollmentId).select('campusId').lean();
  const campusId = row?.campusId || null;
  if (!campusId) return null;

  const campus = await Campus.findById(campusId).select('_id code').lean();
  return campus ? { id: String(campus._id), code: campus.code } : { id: String(campusId), code: null };
}
