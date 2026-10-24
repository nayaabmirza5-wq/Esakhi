import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { User } from '../modules/auth/user.model.js';

export interface AuthUser {
  id: string;
  role: 'customer' | 'staff' | 'admin' | 'delivery_partner';
  status: 'active' | 'disabled';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const authorization = req.header('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    next(new AppError(401, 'UNAUTHORIZED', 'Authentication is required.'));
    return;
  }

  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(authorization.slice(7), env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      next(new AppError(401, 'TOKEN_EXPIRED', 'The access token has expired.'));
      return;
    }
    next(new AppError(401, 'TOKEN_INVALID', 'The access token is invalid.'));
    return;
  }

  if (typeof payload === 'string' || !payload.sub || typeof payload.role !== 'string') {
    next(new AppError(401, 'TOKEN_INVALID', 'The access token is invalid.'));
    return;
  }
  const user = await User.findById(payload.sub).select('_id role status').lean();
  if (!user || user.status !== 'active') {
    next(new AppError(401, 'UNAUTHORIZED', 'The account is unavailable.'));
    return;
  }
  req.user = { id: user._id.toString(), role: user.role, status: user.status };
  next();
};
