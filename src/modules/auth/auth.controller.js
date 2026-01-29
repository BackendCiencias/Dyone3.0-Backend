import { loginService, meService } from './auth.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

// Controlador para autenticación
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.validated;
  const data = await loginService(email, password);
  res.json(data);
});

export const me = asyncHandler(async (req, res) => {
  const data = await meService(req.user);
  console.log(data)
  res.json(data);
});