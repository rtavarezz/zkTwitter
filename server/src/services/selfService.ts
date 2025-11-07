import {
  SelfBackendVerifier,
  DefaultConfigStore,
  AllIds,
  type AttestationId,
} from '@selfxyz/core';
import { z } from 'zod';
import { type BigNumberish } from 'ethers';

const bigNumberish = z.custom<BigNumberish>((val): val is BigNumberish => {
  if (
    typeof val === 'string' ||
    typeof val === 'number' ||
    typeof val === 'bigint'
  ) {
    return true;
  }

  if (typeof val === 'object' && val !== null) {
    if (ArrayBuffer.isView(val)) {
      return true;
    }
    if ('toHexString' in val && typeof (val as { toHexString: unknown }).toHexString === 'function') {
      return true;
    }
  }

  return false;
});

// VcAndDiscloseProof shape from Self SDK
const ProofSchema = z.object({
  a: z.tuple([bigNumberish, bigNumberish]),
  b: z.tuple([
    z.tuple([bigNumberish, bigNumberish]),
    z.tuple([bigNumberish, bigNumberish]),
  ]),
  c: z.tuple([bigNumberish, bigNumberish]),
});

export const SelfProofSchema = z
  .object({
    attestationId: z
      .union([z.literal(1), z.literal(2), z.literal(3)]) as z.ZodType<AttestationId>,
    proof: ProofSchema,
    pubSignals: z.array(bigNumberish).optional(),
    publicSignals: z.array(bigNumberish).optional(),
    userContextData: z.string(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.pubSignals && !value.publicSignals) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either pubSignals or publicSignals must be provided',
      });
    }
  })
  .transform((value) => ({
    attestationId: value.attestationId,
    proof: value.proof,
    pubSignals: value.pubSignals ?? (value.publicSignals as Array<BigNumberish>),
    userContextData: value.userContextData,
  }));

export type SelfProofInput = z.infer<typeof SelfProofSchema>;

const verifier = new SelfBackendVerifier(
  process.env.SELF_SCOPE!,
  process.env.SELF_BACKEND_ENDPOINT!,
  process.env.SELF_MOCK_PASSPORT === 'true',
  AllIds,
  new DefaultConfigStore({
    excludedCountries: [],
    ofac: true,  // Enable OFAC to debug what Self returns
  }),
  process.env.SELF_USER_ID_TYPE as 'uuid' | 'hex'
);

export async function verifyProof(input: SelfProofInput) {
  const validated = SelfProofSchema.parse(input);

  const result = await verifier.verify(
    validated.attestationId,
    validated.proof,
    validated.pubSignals,
    validated.userContextData
  );

  return result;
}
