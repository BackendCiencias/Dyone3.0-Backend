export class ApiError extends Error {
  constructor(status, message, code = undefined) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Recurso no encontrado') {
    super(404, message, 'NOT_FOUND');
  }
}
