import { asyncHandler } from '../../utils/asyncHandler.js';
import { createStudentService, findStudentByDniService } from './students.service.js';

export const createStudent = asyncHandler(async (req, res) => {
  const student = await createStudentService(req.validated);
  res.status(201).json(student);
});

export const searchStudent = asyncHandler(async (req, res) => {
  const { dni } = req.query;
  if (!dni) {
    return res.status(400).json({ message: 'DNI requerido' });
  }
  const student = await findStudentByDniService(dni);
  if (!student) {
    return res.status(404).json({ message: 'Estudiante no encontrado' });
  }
  res.json(student);
});