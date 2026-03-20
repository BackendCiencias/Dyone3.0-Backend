import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const appEnv = process.env.NODE_ENV || 'development';

function loadEnvFile(relativePath, override = false) {
  const filePath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(filePath)) return;
  dotenv.config({ path: filePath, override });
}

// Orden de carga:
// 1. .env como base comun
// 2. .env.<entorno> para separar development / production
// 3. .env.local y .env.<entorno>.local para overrides locales no versionados
loadEnvFile('.env');
loadEnvFile(`.env.${appEnv}`);
loadEnvFile('.env.local', true);
loadEnvFile(`.env.${appEnv}.local`, true);

export const env = {
  APP_ENV: appEnv,
  PORT: process.env.PORT ? Number(process.env.PORT) : 4000,
  MONGODB_URI: process.env.MONGODB_URI,
  JWT_SECRET: process.env.JWT_SECRET,
};

if (!env.MONGODB_URI) {
  console.warn(`Advertencia: MONGODB_URI no esta definido para APP_ENV=${env.APP_ENV}`);
}

if (!env.JWT_SECRET) {
  console.warn(`Advertencia: JWT_SECRET no esta definido para APP_ENV=${env.APP_ENV}`);
}
