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
];

function isAllowedOrigin(origin) {
  if (!origin) return true; // Postman/Server-to-server
  if (allowedOrigins.includes(origin)) return true;

  // Permite previews de Vercel: https://<algo>.vercel.app
  // (si tuvieras otro proyecto, ajusta el patrón)
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

// Importante para preflight
app.options('*', cors());

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

export default app;        // ✅ requerido por Vercel
export { app };            // ✅ opcional (para usar en local/server.js si quieres)
