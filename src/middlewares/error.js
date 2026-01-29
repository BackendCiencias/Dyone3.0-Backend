// Manejador de errores global
// Devuelve respuestas JSON consistentes para cualquier error

export function errorHandler(err, req, res, next) {
  // status predeterminado 500
  const status = err.status || 500;
  let message = err.message || 'Error interno del servidor';

  // Si proviene de validación Zod, formatear array de mensajes
  if (err.name === 'ZodError' && err.errors) {
    message = err.errors.map((e) => e.message);
  }

  // Formato de respuesta
  const errorResponse = {
    message,
  };
  // requestId opcional si existe en la solicitud (se podría agregar en un middleware previo)
  if (req.requestId) {
    errorResponse.requestId = req.requestId;
  }
  res.status(status).json(errorResponse);
}