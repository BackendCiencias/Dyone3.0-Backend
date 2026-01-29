import { ZodError } from 'zod';

// Middleware para validar solicitudes usando Zod
export const validate = (schema) => (req, _res, next) => {
  try {
    const result = schema.parse(req.body);
    // guardar datos validados en la solicitud para su uso posterior
    req.validated = result;
    return next();
  } catch (err) {
    if (err instanceof ZodError) {
      err.status = 400;
    }
    return next(err);
  }
};