const DEFAULT_API_BASE = 'http://localhost:3001';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE;
export const SELF_VERIFY_ENDPOINT = import.meta.env.VITE_SELF_ENDPOINT ?? '';

export function ensureSelfEndpoint(): string {
  if (!SELF_VERIFY_ENDPOINT) {
    throw new Error(
      'VITE_SELF_ENDPOINT is not set. Please provide your public Self callback URL (e.g. ngrok).'
    );
  }
  return SELF_VERIFY_ENDPOINT;
}
