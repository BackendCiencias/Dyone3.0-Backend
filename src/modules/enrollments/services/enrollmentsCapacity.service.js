import mongoose from 'mongoose';
import { Vacancy } from '../../../models/vacancy.model.js';

function toObjectId(value) {
  return value instanceof mongoose.Types.ObjectId ? value : new mongoose.Types.ObjectId(value);
}

export async function getCapacityForClassroom({ classroomId, cycleId, totalCapacity }) {
  const occupied = await Vacancy.countDocuments({
    classroomId: toObjectId(classroomId),
    cycleId: toObjectId(cycleId),
    endDate: null,
  });

  return {
    capacity: Number(totalCapacity),
    occupied,
    available: Math.max(Number(totalCapacity) - occupied, 0),
  };
}

export async function getCapacityForClassrooms(classrooms = []) {
  if (!classrooms.length) return new Map();

  const cycleIds = [...new Set(classrooms.map((row) => String(row.cycleId)))].filter(Boolean);
  const classroomIds = classrooms.map((row) => toObjectId(row._id));

  const occupiedByClassroom = await Vacancy.aggregate([
    {
      $match: {
        classroomId: { $in: classroomIds },
        cycleId: { $in: cycleIds.map((id) => toObjectId(id)) },
        endDate: null,
      },
    },
    { $group: { _id: '$classroomId', occupied: { $sum: 1 } } },
  ]);

  const occupiedMap = new Map(occupiedByClassroom.map((entry) => [String(entry._id), Number(entry.occupied) || 0]));

  const capacityMap = new Map();
  for (const classroom of classrooms) {
    const capacity = Number(classroom.capacity) || 0;
    const occupied = occupiedMap.get(String(classroom._id)) || 0;

    capacityMap.set(String(classroom._id), {
      capacity,
      occupied,
      available: Math.max(capacity - occupied, 0),
    });
  }

  return capacityMap;
}
