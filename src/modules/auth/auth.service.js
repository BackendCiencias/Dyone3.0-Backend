import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../../models/user.model.js';
import { Person } from "../../models/person.model.js";
import { ApiError } from '../../utils/errors.js';
import { env } from '../../config/env.js';

// Servicio de autenticación
export async function loginService(email, password) {
  const user = await User.findOne({ email });
  if (!user) {
    throw new ApiError(401, 'Credenciales incorrectas');
  }
  if (!user.isActive) {
    throw new ApiError(401, 'Usuario inactivo');
  }
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    throw new ApiError(401, 'Credenciales incorrectas');
  }
  const payload = {
    id: user._id.toString(),
    roles: user.roles,
    campusScope: user.campusScope || [],
  };
  // console.log(payload)
  const token = jwt.sign(payload, env.JWT_SECRET, { expiresIn: '8h' });
  return { token };
}

export async function meService(jwtUser) {
  // jwtUser lo setea el middleware: { id, roles }
  const user = await User.findById(jwtUser.id).lean();
  if (!user) throw new ApiError(401, "Token inválido");
  if (!user.isActive) throw new ApiError(401, "Usuario inactivo");

  const person = await Person.findById(user.personId).lean();

  return {
    user: {
      id: user._id.toString(),
      email: user.email,
      personId: user.personId?.toString() || null,
      person: person
        ? {
            id: person._id.toString(),
            names: person.names,
            lastNames: person.lastNames,
            dni: person.dni,
          }
        : null,
      isActive: user.isActive,
    },
    roles: user.roles || [],
    campusScope: user.campusScope || [],
  };
}