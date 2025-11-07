import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import pino from 'pino';
import authRoutes from './routes/auth.js';
import timelineRoutes from './routes/timeline.js';
import usersRoutes from './routes/users.js';
import messagesRoutes from './routes/messages.js';
import generationRoutes from './routes/generation.js';
import { errorHandler } from './middleware/errorHandler.js';
import { logger } from './lib/logger.js';

// Validate required environment variables
const requiredEnv = ['SELF_SCOPE', 'SELF_BACKEND_ENDPOINT', 'JWT_SECRET', 'DATABASE_URL'];
requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
});

const app = express();
const port = process.env.PORT || 3001;

app.set('trust proxy', 1);

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200,
}));

app.use(
  pinoHttp({
    logger,
    customLogLevel: (req, res, err) => {
      if (res.statusCode >= 400 && res.statusCode < 500) return 'warn';
      if (res.statusCode >= 500 || err) return 'error';
      return 'info';
    },
    serializers: {
      req: (req) => ({
        method: req.method,
        url: req.url,
        headers: { ...req.headers, authorization: '[REDACTED]' },
      }),
      res: pino.stdSerializers.res,
    },
  })
);

app.use(express.json({ limit: '1mb' }));

// Routes
app.use('/auth', authRoutes);
app.use('/tweets', timelineRoutes);
app.use('/users', usersRoutes);
app.use('/messages', messagesRoutes);
app.use('/generation', generationRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Error handling
app.use(errorHandler);

app.listen(port, () => {
  logger.info(`zkTwitter server listening on port ${port}`);
});
