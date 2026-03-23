import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { Charge } from '../src/models/charge.model.js';
import { Vacancy } from '../src/models/vacancy.model.js';
import { Classroom } from '../src/models/classroom.model.js';
import { getEnrollmentContextForStudent } from '../src/shared/enrollmentCurrent.js';

dotenv.config();

const uri = process.env.MONGODB_URI;

async function resolveCampusId(charge) {
  const currentEnrollment = await getEnrollmentContextForStudent(charge.studentId, { cycleId: charge.cycleId });
  if (currentEnrollment?.campus?._id) return currentEnrollment.campus._id;
  if (currentEnrollment?.enrollment?.campusId) return currentEnrollment.enrollment.campusId;

  const vacancy = await Vacancy.findOne({
    studentId: charge.studentId,
    cycleId: charge.cycleId,
  }).select('classroomId').lean();

  if (!vacancy?.classroomId) return null;

  const classroom = await Classroom.findById(vacancy.classroomId).select('campusId').lean();
  return classroom?.campusId || null;
}

async function run() {
  if (!uri) throw new Error('MONGODB_URI no configurado');

  await mongoose.connect(uri);

  let processed = 0;
  let updated = 0;
  let skipped = 0;

  const cursor = Charge.find({ $or: [{ campusId: { $exists: false } }, { campusId: null }] })
    .select('_id studentId cycleId campusId')
    .lean()
    .cursor();

  for await (const charge of cursor) {
    processed += 1;
    const campusId = await resolveCampusId(charge);
    if (!campusId) {
      skipped += 1;
      continue;
    }

    await Charge.updateOne({ _id: charge._id }, { $set: { campusId } });
    updated += 1;
  }

  console.log('[backfill:charges-campus]', { processed, updated, skipped });
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error('[backfill:charges-campus][error]', error.message);
  await mongoose.disconnect();
  process.exit(1);
});
