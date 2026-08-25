// BEACON — gateway capability seal (E6·T-255/T-256; ADR-017/F16/CM-C1; D-29).
// The compliance stamp is an in-process capability token minted ONLY by the gateway and passed
// in-memory to provider adapters — never over the wire — so an adapter cannot forge it and an
// un-stamped call to the LLM/Vision provider is refused (closes the adapter-bypass A5 risk).
// Implemented as a short-lived jose HS256 JWT signed with a process-local random secret.
import { randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

export interface StampClaims {
  readonly operation: string; // e.g. 'llm.narrate' | 'vision.analyze'
  readonly modelTier: string;
  readonly maxTokens: number;
}

export class GateSeal {
  readonly #secret: Uint8Array;

  constructor(secret?: Uint8Array) {
    this.#secret = secret ?? new Uint8Array(randomBytes(32));
  }

  /** Mint a capability stamp for a single sanctioned upstream call. */
  mint(claims: StampClaims): Promise<string> {
    return new SignJWT({ ...claims })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('2m')
      .sign(this.#secret);
  }

  /** Verify a stamp; returns its claims or null (adapters refuse the call on null). */
  async verify(token: string): Promise<StampClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.#secret);
      return {
        operation: String(payload.operation),
        modelTier: String(payload.modelTier),
        maxTokens: Number(payload.maxTokens),
      };
    } catch {
      return null;
    }
  }
}

export const makeGateSeal = (secret?: Uint8Array): GateSeal => new GateSeal(secret);
