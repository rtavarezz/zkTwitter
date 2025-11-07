import { z } from 'zod';
import { logger } from '../lib/logger.js';

const RegistrationContextSchema = z.object({
  action: z.literal('registration'),
  handle: z.string(),
  userId: z.string(),
  avatarUrl: z.string().optional(),
});

const LoginContextSchema = z.object({
  action: z.literal('login'),
  handle: z.string(),
  userId: z.string(),
  sessionId: z.string(),
});

const ContextSchema = z.union([RegistrationContextSchema, LoginContextSchema]);

export type DecodedUserContext = z.infer<typeof ContextSchema>;

function decodeFromHexPayload(hexPayload: string): DecodedUserContext | null {
  try {
    const buffer = Buffer.from(hexPayload, 'hex');
    const utf8 = buffer.toString('utf8');
    const jsonStart = utf8.indexOf('{');
    if (jsonStart === -1) {
      return null;
    }
    const json = utf8.substring(jsonStart);
    return ContextSchema.parse(JSON.parse(json));
  } catch {
    return null;
  }
}

export function decodeUserContextData(raw: string): DecodedUserContext {
  const cleaned = raw.startsWith('0x') ? raw.slice(2) : raw;

  // Self has shipped two encodings so far. Try full payload first, then fall back to old offsets.
  const candidates = [cleaned, cleaned.slice(64), cleaned.slice(96), cleaned.slice(128)];

  for (const candidate of candidates) {
    const decoded = decodeFromHexPayload(candidate);
    if (decoded) {
      return decoded;
    }
  }

  logger.error({ raw }, 'Failed to decode userContextData');
  throw new Error('Invalid userContextData payload');
}
