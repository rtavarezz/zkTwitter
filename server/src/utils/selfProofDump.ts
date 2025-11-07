import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../lib/logger.js';
import type { SelfProofInput, verifyProof } from '../services/selfService.js';
import type { DecodedUserContext } from './userContext.js';

type VerificationResult = Awaited<ReturnType<typeof verifyProof>>;

const rawDumpDir = process.env.SELF_PROOF_DUMP_DIR;
const modulePath = fileURLToPath(import.meta.url);
const serverRoot = path.resolve(path.dirname(modulePath), '..', '..');
const dumpDir = rawDumpDir
  ? path.isAbsolute(rawDumpDir)
    ? rawDumpDir
    : path.resolve(serverRoot, rawDumpDir)
  : undefined;
const isProd = process.env.NODE_ENV === 'production';

type DumpPayload = {
  proof: SelfProofInput;
  result: VerificationResult;
  context: DecodedUserContext;
};

export async function maybeDumpSelfProof({ proof, result, context }: DumpPayload) {
  if (!dumpDir || isProd) {
    return;
  }

  try {
    await fs.mkdir(dumpDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeHandle = (context.handle ?? 'unknown').replace(/[^a-z0-9_-]/gi, '_');
    const fileName = `${timestamp}_${context.action}_${safeHandle}.json`;
    const filePath = path.join(dumpDir, fileName);

    const payload = {
      capturedAt: new Date().toISOString(),
      context,
      proof: {
        attestationId: proof.attestationId,
        proof: proof.proof,
        pubSignals: proof.pubSignals,
        userContextData: proof.userContextData,
      },
      verification: {
        isValidDetails: result.isValidDetails,
        discloseOutput: result.discloseOutput,
        forbiddenCountriesList: result.forbiddenCountriesList,
        userData: result.userData,
      },
    };

    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
    logger.info({ filePath }, 'Dumped Self proof payload for circuit development');
  } catch (error) {
    logger.warn({ error }, 'Failed to dump Self proof payload');
  }
}
