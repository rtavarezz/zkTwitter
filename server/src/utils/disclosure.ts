import { logger } from '../lib/logger.js';

type DisclosureSource = {
  nationality?: string;
  dateOfBirth?: string;
};

export function buildDisclosedPayload(
  disclosure: DisclosureSource | undefined,
  isMinimumAgeValid: boolean
) {
  const payload: Record<string, unknown> = {};

  if (disclosure?.nationality) {
    payload.country = disclosure.nationality;
  }

  if (disclosure?.dateOfBirth) {
    payload.dateOfBirth = disclosure.dateOfBirth;
  }

  if (isMinimumAgeValid) {
    payload.is21 = true;
  }

  return payload;
}

export function safeParseDisclosed(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch (error) {
    logger.warn({ error }, 'Failed to parse disclosed payload');
    return {};
  }
}
