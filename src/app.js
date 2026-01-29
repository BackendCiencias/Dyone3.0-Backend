import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { errorHandler } from './middlewares/error.js';

// Import routers
import authRouter from './modules/auth/auth.routes.js';
import adminRouter from './modules/admin/admin.routes.js';
import familiesRouter from './modules/families/families.routes.js';
import studentsRouter from './modules/students/students.routes.js';
import paymentsRouter from './modules/payments/payments.routes.js';
import enrollmentsRouter from './modules/enrollments/enrollments.routes.js';
// Empty modules export routers but currently they are TODO
import attendanceRouter from './modules/attendance/attendance.routes.js';
import gradesRouter from './modules/grades/grades.routes.js';
import clubRouter from './modules/club/club.routes.js';
import reportsRouter from './modules/reports/reports.routes.js';

export const app = express();

// Configurar middlewares básicos
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(morgan('dev'));

// Ruta de salud
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Montar rutas de la API
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/families', familiesRouter);
app.use('/api/students', studentsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/enrollments', enrollmentsRouter);
// Rutas vacías por ahora
app.use('/api/attendance', attendanceRouter);
app.use('/api/grades', gradesRouter);
app.use('/api/club', clubRouter);
app.use('/api/reports', reportsRouter);

// Manejador de errores global
app.use(errorHandler);