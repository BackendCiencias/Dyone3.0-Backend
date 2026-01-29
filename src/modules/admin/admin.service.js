import { Campus } from '../../models/campus.model.js';
import { Cycle } from '../../models/cycle.model.js';
import { Classroom } from '../../models/classroom.model.js';
import { BillingConcept } from '../../models/billingConcept.model.js';

// Servicios del módulo de administración

export async function createCampus(data) {
  const campus = new Campus(data);
  return campus.save();
}

export async function listCampuses() {
  return Campus.find();
}

export async function createCycle(data) {
  // Convertir fechas a objetos Date
  const cycle = new Cycle({
    ...data,
    startDate: new Date(data.startDate),
    endDate: new Date(data.endDate),
  });
  return cycle.save();
}

export async function listCycles() {
  return Cycle.find();
}

export async function createClassroom(data) {
  const classroom = new Classroom(data);
  return classroom.save();
}

export async function listClassrooms() {
  return Classroom.find().populate('campusId').populate('cycleId');
}

export async function createBillingConcept(data) {
  const concept = new BillingConcept(data);
  return concept.save();
}

export async function listBillingConcepts() {
  return BillingConcept.find();
}