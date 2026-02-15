export function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  let message = err.message || 'Error interno del servidor';
  let code = err.code;

  if (err.name === 'ZodError' && err.errors) {
    message = err.errors.map((e) => e.message);
    code = code || 'VALIDATION_ERROR';
  }

  if (err?.name === 'MongoServerError' && err?.code === 11000) {
    message = 'Conflicto de datos duplicados';
    code = 'DUPLICATE_KEY';
  }

  const errorResponse = { message };
  if (code) errorResponse.code = code;
  if (req.requestId) errorResponse.requestId = req.requestId;

  if (status >= 500) {
    console.error('[error-handler]', {
      message: err?.message,
      stack: err?.stack,
      code: err?.code,
    });
  }

  res.status(status).json(errorResponse);
}
