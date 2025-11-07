import { logger } from '../lib/logger.js';

type DisclosureSource = {
  nationality?: string;
  dateOfBirth?: string;
  name?: string;
  gender?: string;
  issuingState?: string;
  idNumber?: string;
  expiryDate?: string;
  minimumAge?: string;
};

const NULL_BYTE = '\u0000';
const EMPTY_PATTERNS: Record<string, string> = {
  dateOfBirth: NULL_BYTE.repeat(6),
  idNumber: NULL_BYTE.repeat(9),
  expiryDate: NULL_BYTE.repeat(6),
};

function isValidValue(value: string | undefined, field?: keyof typeof EMPTY_PATTERNS): boolean {
  if (!value?.trim()) return false;
  if (field && EMPTY_PATTERNS[field] === value) return false;
  return true;
}

export function buildDisclosedPayload(
  disclosure: DisclosureSource | undefined,
  isMinimumAgeValid: boolean
) {
  if (!disclosure) return isMinimumAgeValid ? { is21: true } : {};

  const payload: Record<string, unknown> = {};

  if (isValidValue(disclosure.nationality)) payload.country = disclosure.nationality;
  if (isValidValue(disclosure.dateOfBirth, 'dateOfBirth')) payload.dateOfBirth = disclosure.dateOfBirth;
  if (isValidValue(disclosure.name)) payload.name = disclosure.name;
  if (disclosure.gender && disclosure.gender !== NULL_BYTE) payload.gender = disclosure.gender;
  if (isValidValue(disclosure.issuingState)) payload.issuingState = disclosure.issuingState;
  if (isValidValue(disclosure.idNumber, 'idNumber')) payload.passportNumber = disclosure.idNumber;
  if (isValidValue(disclosure.expiryDate, 'expiryDate')) payload.expiryDate = disclosure.expiryDate;
  if (disclosure.minimumAge) payload.minimumAge = disclosure.minimumAge;
  if (isMinimumAgeValid) payload.is21 = true;

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
