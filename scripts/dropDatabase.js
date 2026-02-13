import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI;

async function dropDatabase() {
  try {
    if (!MONGO_URI) {
      throw new Error('Falta la variable MONGODB_URI en el entorno');
    }

    console.log('🔌 Conectando a la base de datos...');
    await mongoose.connect(MONGO_URI);

    const dbName = mongoose.connection.name;
    console.log(`🗑️  Dropeando base de datos: ${dbName}`);

    await mongoose.connection.db.dropDatabase();

    console.log('✅ Base de datos eliminada. Puedes correr los seeds/imports nuevamente.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error al dropear la base de datos:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
}

dropDatabase();
