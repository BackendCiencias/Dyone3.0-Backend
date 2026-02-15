import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { errorHandler } from './middlewares/error.js';
import { connectDB } from './config/db.js';

// Import routers
import authRouter from './modules/auth/auth.routes.js';
import adminRouter from './modules/admin/admin.routes.js';
import familiesRouter from './modules/families/families.routes.js';
import studentsRouter from './modules/students/students.routes.js';
import paymentsRouter from './modules/payments/payments.routes.js';
import tutorsRouter from './modules/tutors/tutors.routes.js';
import chargesRouter from './modules/charges/charges.routes.js';
import enrollmentsRouter from './modules/enrollments/enrollments.routes.js';
// Empty modules export routers but currently they are TODO
import attendanceRouter from './modules/attendance/attendance.routes.js';
import gradesRouter from './modules/grades/grades.routes.js';
import clubRouter from './modules/club/club.routes.js';
import reportsRouter from './modules/reports/reports.routes.js';

const app = express();

// Conecta a DB (cacheado en db.js, así no reconecta siempre)
connectDB().catch((err) => {
  console.error('Error conectando a MongoDB:', err);
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

// Ruta de salud
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Montar rutas de la API
const routeCatalogMounts = [
  { basePath: '/api/auth', module: 'auth', router: authRouter, authRequired: null, rolesAllowed: null },
  { basePath: '/api/admin', module: 'admin', router: adminRouter, authRequired: true, rolesAllowed: null },
  { basePath: '/api/families', module: 'families', router: familiesRouter, authRequired: true, rolesAllowed: null },
  { basePath: '/api/students', module: 'students', router: studentsRouter, authRequired: true, rolesAllowed: null },
  { basePath: '/api/payments', module: 'payments', router: paymentsRouter, authRequired: true, rolesAllowed: null },
  { basePath: '/api/tutors', module: 'tutors', router: tutorsRouter, authRequired: true, rolesAllowed: null },
  { basePath: '/api/charges', module: 'charges', router: chargesRouter, authRequired: true, rolesAllowed: null },
  { basePath: '/api/enrollments', module: 'enrollments', router: enrollmentsRouter, authRequired: true, rolesAllowed: null },
  { basePath: '/api/attendance', module: 'attendance', router: attendanceRouter, authRequired: true, rolesAllowed: null },
  { basePath: '/api/grades', module: 'grades', router: gradesRouter, authRequired: true, rolesAllowed: null },
  { basePath: '/api/club', module: 'club', router: clubRouter, authRequired: true, rolesAllowed: null },
  { basePath: '/api/reports', module: 'reports', router: reportsRouter, authRequired: true, rolesAllowed: null },
];

app.locals.routeCatalogMounts = routeCatalogMounts;

for (const mount of routeCatalogMounts) {
  app.use(mount.basePath, mount.router);
}

// Manejador de errores global
app.use(errorHandler);

export default app;        // ✅ requerido por Vercel
export { app };            // ✅ opcional (para usar en local/server.js si quieres)
