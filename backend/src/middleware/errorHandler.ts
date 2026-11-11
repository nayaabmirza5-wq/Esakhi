import type { ErrorRequestHandler } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';
import multer from 'multer';

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const tooLarge = error.code === 'LIMIT_FILE_SIZE';
    res.status(tooLarge ? 413 : 400).json({
      success: false,
      error: {
        code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'INVALID_UPLOAD',
        message: tooLarge ? 'Product images must be 5 MB or smaller.' : 'The image upload is invalid.',
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    const fields: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const key = issue.path.join('.') || 'request';
      fields[key] = [...(fields[key] ?? []), issue.message];
    }
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Validation failed', fields },
    });
    return;
  }

  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.fields ? { fields: error.fields } : {}),
      },
    });
    return;
  }

  if (error instanceof mongoose.Error.ValidationError) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'The submitted data is invalid.' },
    });
    return;
  }

  if (error instanceof mongoose.Error.CastError) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_REQUEST', message: 'A request identifier is invalid.' },
    });
    return;
  }

  if (isDatabaseUnavailableError(error)) {
    logger.error('Database unavailable during request', {
      name: error instanceof Error ? error.name : 'MongoNetworkError',
    });
    res.status(503).json({
      success: false,
      error: { code: 'DATABASE_UNAVAILABLE', message: 'The database is temporarily unavailable.' },
    });
    return;
  }

  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
    res.status(409).json({
      success: false,
      error: { code: 'CONFLICT', message: 'A record with the same unique value already exists.' },
    });
    return;
  }

  if (error instanceof SyntaxError && typeof error === 'object' && error !== null && 'status' in error && error.status === 400) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_REQUEST', message: 'The request body contains invalid JSON.' },
    });
    return;
  }

  if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') {
    res.status(413).json({
      success: false,
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large.' },
    });
    return;
  }

  logger.error('Unhandled request error', {
    name: error instanceof Error ? error.name : 'UnknownError',
    errorMessage: error instanceof Error ? error.message : 'Unknown error',
    ...(env.NODE_ENV === 'production' ? {} : {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    }),
  });
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.' },
  });
};

function isDatabaseUnavailableError(error: unknown): boolean {
  if (error instanceof mongoose.Error.MongooseServerSelectionError) return true;
  if (typeof error !== 'object' || error === null) return false;
  if ('name' in error && typeof error.name === 'string') {
    if (['MongoNetworkError', 'MongoNetworkTimeoutError', 'MongoServerSelectionError', 'MongoTimeoutError'].includes(error.name)) {
      return true;
    }
  }
  if ('message' in error && typeof error.message === 'string') {
    if (error.message.startsWith('querySrv ') || error.message.startsWith('queryTxt ')) {
      return true;
    }
  }
  return false;
}
