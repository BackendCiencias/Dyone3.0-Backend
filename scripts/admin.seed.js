import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

import { Person } from '../src/models/person.model.js';
import { User } from '../src/models/user.model.js';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI;
const PASSWORD = 'CienciasyCimas2026';

const usersToSeed = [
  {
    email: 'admin@cienciasperu.edu.pe',
    roles: ['ADMIN'],
    campusScope: ['ALL'],
    person: {
      names: 'Administrador',
      lastNames: 'Sistema',
      dni: '00000001',
      gender: 'M',
    },
  },
  {
    email: 'secretaria@cienciasperu.edu.pe',
    roles: ['SECRETARY'],
    campusScope: ['CIENCIAS', 'CIMAS'],
    person: {
      names: 'Secretaria',
      lastNames: 'Principal',
      dni: '00000002',
      gender: 'F',
    },
  },
  {
    email: 'secretaria.viewer@cienciasperu.edu.pe',
    roles: ['SECRETARY_VIEWER'],
    campusScope: ['CIENCIAS'],
    person: {
      names: 'Secretaria',
      lastNames: 'Viewer',
      dni: '00000003',
      gender: 'F',
    },
  },
  {
    email: 'auxiliar@cienciasperu.edu.pe',
    roles: ['AUXILIAR'],
    campusScope: ['CIENCIAS'],
    person: {
      names: 'Auxiliar',
      lastNames: 'Operaciones',
      dni: '00000004',
      gender: 'M',
    },
  },
];

async function seed() {
  try {
    console.log('🔌 Conectando a la base de datos...');
    await mongoose.connect(MONGO_URI);

    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    for (const u of usersToSeed) {
      const existingUser = await User.findOne({ email: u.email });

      if (existingUser) {
        console.log(`⚠️  Usuario ya existe: ${u.email}`);
        continue;
      }

      let person = await Person.findOne({ dni: u.person.dni });

      if (!person) {
        person = await Person.create({
          names: u.person.names,
          lastNames: u.person.lastNames,
          dni: u.person.dni,
          gender: u.person.gender,
        });
      }

      await User.create({
        personId: person._id,
        email: u.email,
        passwordHash,
        roles: u.roles,
        campusScope: u.campusScope,
        isActive: true,
      });

      console.log(`✅ Usuario creado: ${u.email}`);
    }

    console.log('🎉 Seed finalizado correctamente');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error ejecutando seed:', error);
    process.exit(1);
  }
}

seed();
