import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import { errorHandler } from './middlewares/error.js';
import { connectDB, getDbStatus } from './config/db.js';

// Import routers
import authRouter from './modules/auth/auth.routes.js';
import adminRouter from './modules/admin/admin.routes.js';
import studentsRouter from './modules/students/students.routes.js';
import paymentsRouter from './modules/payments/payments.routes.js';
import tutorsRouter from './modules/tutors/tutors.routes.js';
import chargesRouter from './modules/charges/charges.routes.js';
import enrollmentsRouter from './modules/enrollments/enrollments.routes.js';
import classroomsRouter from './modules/classrooms/classrooms.routes.js';
import dashboardRouter from './modules/dashboard/dashboard.routes.js';
// Empty modules export routers but currently they are TODO
import attendanceRouter from './modules/attendance/attendance.routes.js';
import gradesRouter from './modules/grades/grades.routes.js';
import clubRouter from './modules/club/club.routes.js';
import reportsRouter from './modules/reports/reports.routes.js';
import { validateEndpointMetadataShape } from './admin/endpointMetadataRegistry.js';

const app = express();

// Intento inicial de conexión; no bloquea el arranque.
connectDB().catch((err) => {
  console.error('DB init error:', err?.message || err);
});

// Configurar middlewares básicos
app.use(helmet());
// Si usas cookies (ahora o después), esto ayuda en Vercel/Proxies
app.set('trust proxy', 1);

const allowedOrigins = [
  'https://dyone3-frontend.vercel.app',
  'https://www.cienciasperu.edu.pe',
  'http://localhost:5173',
];

function isAllowedOrigin(origin) {
  if (!origin) return true; // Postman / server-to-server

  if (allowedOrigins.includes(origin)) return true;

  // Previews de Vercel: https://<algo>.vercel.app
  const vercelPreview = /^https:\/\/.*\.vercel\.app$/;
  return vercelPreview.test(origin);
}

app.use(
  cors({
    origin: (origin, cb) => {
      if (isAllowedOrigin(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Preflight
app.options('*', cors());

app.use(express.json());
app.use(cookieParser());
app.use(morgan('dev'));

async function ensureDb(_req, _res, next) {
  try {
    if (mongoose.connection.readyState !== 1) {
      await connectDB();
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

// Ruta de salud
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/health/db', async (_req, res) => {
  try {
    await connectDB();
    return res.json({
      ok: true,
      db: getDbStatus(),
    });
  } catch (err) {
    return res.status(503).json({
      ok: false,
      db: getDbStatus(),
      error: err?.message || 'DB unavailable',
    });
  }
});

app.use('/api', ensureDb);

// Montar rutas de la API
const routeCatalogMounts = [
  { basePath: '/api/auth', module: 'auth', router: authRouter, authRequired: null, rolesAllowed: null },
  { basePath: '/api/admin', module: 'admin', router: adminRouter, authRequired: true, rolesAllowed: null },
  { basePath: '/api/students', module: 'students', router: studentsRouter, authRequired: true, rolesAllowed: null },
  { basePath: '/api/payments', module: 'payments', router: paymentsRouter, authRequired: true, rolesAllowed: null },
  { basePath: '/api/tutors', module: 'tutors', router: tutorsRouter, authRequired: true, rolesAllowed: null },
  { basePath: '/api/charges', module: 'charges', router: chargesRouter, authRequired: true, rolesAllowed: null },
  { basePath: '/api/enrollments', module: 'enrollments', router: enrollmentsRouter, authRequired: true, rolesAllowed: null },
  { basePath: '/api/classrooms', module: 'classrooms', router: classroomsRouter, authRequired: true, rolesAllowed: null },
  { basePath: '/api/dashboard', module: 'dashboard', router: dashboardRouter, authRequired: true, rolesAllowed: null },
  { basePath: '/api/attendance', module: 'attendance', router: attendanceRouter, authRequired: true, rolesAllowed: null },
  { basePath: '/api/grades', module: 'grades', router: gradesRouter, authRequired: true, rolesAllowed: null },
  { basePath: '/api/club', module: 'club', router: clubRouter, authRequired: true, rolesAllowed: null },
  { basePath: '/api/reports', module: 'reports', router: reportsRouter, authRequired: true, rolesAllowed: null },
];

app.locals.routeCatalogMounts = routeCatalogMounts;
validateEndpointMetadataShape();

for (const mount of routeCatalogMounts) {
  app.use(mount.basePath, mount.router);
}

// Manejador de errores global
app.use(errorHandler);

export default app; // ✅ requerido por Vercel
export { app }; // ✅ opcional (para usar en local/server.js si quieres)
