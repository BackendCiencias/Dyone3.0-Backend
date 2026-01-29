import mongoose from 'mongoose';
import { env } from './env.js';

export async function connectDB() {
  if (!env.MONGODB_URI) {
    throw new Error('MONGODB_URI no configurado');
  }
  await mongoose.connect(env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  }).catch((err) => {
    console.error('Error conectando a MongoDB:', err);
    throw err;
  });
  console.log('Conectado a MongoDB');
}