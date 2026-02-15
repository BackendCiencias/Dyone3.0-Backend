import mongoose from 'mongoose';
import { env } from './env.js';

mongoose.set('bufferCommands', false);

const globalCache = globalThis;

if (!globalCache.__mongooseCache) {
  globalCache.__mongooseCache = {
    conn: null,
    promise: null,
    listenersAttached: false,
  };
}

const cached = globalCache.__mongooseCache;

if (!cached.listenersAttached) {
  mongoose.connection.on('connected', () => {
    console.log('DB connected');
  });

  mongoose.connection.on('disconnected', () => {
    console.log('DB disconnected');
  });

  mongoose.connection.on('error', (err) => {
    console.log('DB connection error', err?.message || err);
  });

  cached.listenersAttached = true;
}

export function getDbStatus() {
  return {
    readyState: mongoose.connection.readyState,
    host: mongoose.connection.host || null,
    name: mongoose.connection.name || null,
  };
}

export async function connectDB() {
  if (!env.MONGODB_URI) {
    throw new Error('MONGODB_URI no configurado');
  }

  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  if (cached.promise) {
    return cached.promise;
  }

  console.log('DB connecting...');

  cached.promise = mongoose
    .connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 20000,
      connectTimeoutMS: 20000,
      maxPoolSize: 10,
    })
    .then((mongooseInstance) => {
      cached.conn = mongooseInstance;
      return mongooseInstance;
    })
    .catch((err) => {
      cached.promise = null;
      cached.conn = null;
      throw err;
    });

  try {
    return await cached.promise;
  } finally {
    if (mongoose.connection.readyState !== 1) {
      cached.promise = null;
    }
  }
}
