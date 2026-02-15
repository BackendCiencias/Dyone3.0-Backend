import { ZodError } from 'zod';

export const validateRequest = ({ params, query, body }) => (req, _res, next) => {
  try {
    if (params) req.validatedParams = params.parse(req.params);
    if (query) req.validatedQuery = query.parse(req.query);
    if (body) req.validated = body.parse(req.body);
    next();
  } catch (error) {
    if (error instanceof ZodError) error.status = 400;
    next(error);
  }
};
