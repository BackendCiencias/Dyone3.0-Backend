import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

import { Person } from "../src/models/person.model.js";
import { User } from "../src/models/user.model.js";

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI;
const PASSWORD = "CienciasyCimas2026";

const usersToSeed = [
  {
    email: "admin@cienciasperu.edu.pe",
    roles: ["ADMIN","SECRETARY_CIENCIAS_SEC","SECRETARY_CIENCIAS_PRIM","SECRETARY_CIMAS"],
    person: {
      names: "Administrador",
      lastNames: "Sistema",
      dni: "00000001",
      gender: "Masculino",
    },
  },
  {
    email: "secretaria@cienciasperu.edu.pe",
    roles: ["SECRETARY_CIENCIAS_SEC"],
    person: {
      names: "Secretaria",
      lastNames: "Ciencias",
      dni: "00000002",
      gender: "Femenino",
    },
  },
];

async function seed() {
  try {
    console.log("🔌 Conectando a la base de datos...");
    await mongoose.connect(MONGO_URI);

    

    console.log('🧹 Eliminando usuarios...');
    await User.deleteMany({});


    console.log('🧹 Eliminando personas...');
    await Person.deleteMany({});


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
        isActive: true,
      });

      console.log(`✅ Usuario creado: ${u.email}`);
    }

    console.log("🎉 Seed finalizado correctamente");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error ejecutando seed:", error);
    process.exit(1);
  }
}

seed();
