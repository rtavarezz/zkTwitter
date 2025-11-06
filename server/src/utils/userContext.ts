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

export function decodeUserContextData(raw: string): DecodedUserContext {
  const cleaned = raw.startsWith('0x') ? raw.slice(2) : raw;

  try {
    // Self SDK encodes with 64-char length prefix + 32-char UUID prefix
    const hexData = cleaned.slice(96);
    const buffer = Buffer.from(hexData, 'hex');
    const fullDecoded = buffer.toString('utf8');

    // Find the first '{' character (JSON start)
    const jsonStart = fullDecoded.indexOf('{');
    if (jsonStart === -1) {
      throw new Error('No JSON found in hex data');
    }

    const json = fullDecoded.substring(jsonStart);
    return ContextSchema.parse(JSON.parse(json));
  } catch (error) {
    logger.error({ error, raw }, 'Failed to decode userContextData');
    throw new Error('Invalid userContextData payload');
  }
}
