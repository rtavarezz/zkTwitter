import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../lib/logger.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  const requestId = req.headers['x-request-id'] || 'unknown';

  if (err instanceof ZodError) {
    logger.warn({ requestId, errors: err.errors }, 'Validation error');
    return res.status(400).json({
      error: 'Validation failed',
      requestId,
      details: err.errors,
    });
  }

  logger.error({ requestId, err }, 'Unhandled error');

  res.status(500).json({
    error: 'Internal server error',
    requestId,
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
}
