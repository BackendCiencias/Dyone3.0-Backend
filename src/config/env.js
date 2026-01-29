import dotenv from 'dotenv';

// Cargar variables de entorno desde .env
dotenv.config();

// Validar y exponer variables necesarias
export const env = {
  PORT: process.env.PORT ? Number(process.env.PORT) : 4000,
  MONGODB_URI: process.env.MONGODB_URI,
  JWT_SECRET: process.env.JWT_SECRET,
};

// Comprobación básica de variables requeridas
if (!env.MONGODB_URI) {
  console.warn('Advertencia: MONGODB_URI no está definido');
}
if (!env.JWT_SECRET) {
  console.warn('Advertencia: JWT_SECRET no está definido');
}