import mongoose from 'mongoose';
import { env } from './env.js';

let cached = global._mongoose;

if (!cached) {
  cached = global._mongoose = { conn: null, promise: null };
}

export async function connectDB() {
  if (!env.MONGODB_URI) {
    throw new Error('MONGODB_URI no configurado');
  }

  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose.connect(env.MONGODB_URI).then((m) => m);
  }

  cached.conn = await cached.promise;
  console.log('Conectado a MongoDB');
  return cached.conn;
}
