import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../lib/logger.js';

interface AuthPayload {
  sub: string;
  handle: string;
  human: boolean;
  country?: string;
  is21?: boolean;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthPayload;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = header.slice('Bearer '.length);

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as AuthPayload;
    req.auth = payload;

    if (!payload.human) {
      return res.status(403).json({ error: 'Only verified humans can perform this action' });
    }

    return next();
  } catch (err) {
    logger.warn({ err }, 'JWT verification failed');
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
