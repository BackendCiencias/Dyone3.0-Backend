import { Router } from 'express';
import { login, me } from './auth.controller.js';
import { validate } from '../../middlewares/validate.js';
import { loginSchema } from './auth.schemas.js';
import { authMiddleware } from "../../middlewares/auth.js";

const router = Router();

// Ruta de inicio de sesión
router.post('/login', validate(loginSchema), login);
router.get("/me", authMiddleware, me);

export default router;