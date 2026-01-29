// Envoltorio para controladores asíncronos
// Captura excepciones y pasa a next()
export function asyncHandler(fn) {
  return function asyncWrap(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}