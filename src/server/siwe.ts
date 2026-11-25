// Sign-In with Ethereum (EIP-4361) verification for BankrDex profiles. The message must be for
// this host, on Base, recent, and carry a nonce this server issued (consumed once). Plain
// wallets are checked offline; smart wallets (ERC-1271 / ERC-6492, e.g. Coinbase Smart Wallet)
// through a Base RPC call.
import { createPublicClient, fallback, http, isAddressEqual, recoverMessageAddress, type Hex } from 'viem';
import { base } from 'viem/chains';
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe';

const MAX_AGE_MS = 10 * 60_000;
const client = createPublicClient({
  chain: base,
  transport: fallback([
    http('https://mainnet.base.org', { timeout: 10_000 }),
    http('https://base-rpc.publicnode.com', { timeout: 10_000 }),
  ]),
});

export type SiweFailure = 'malformed' | 'domain' | 'chain' | 'expired' | 'nonce' | 'signature';

export interface SiweCheck {
  ok: boolean;
  wallet?: string;
  nonce?: string;
  reason?: SiweFailure;
}

// Field checks that need no network: returns the claimed wallet and nonce.
export function checkSiweMessage(message: string, host: string, now = Date.now()): SiweCheck {
  if (typeof message !== 'string' || message.length > 2_000) return { ok: false, reason: 'malformed' };
  const fields = parseSiweMessage(message);
  if (!fields.address || !fields.nonce || !fields.domain || !fields.uri || fields.version !== '1') return { ok: false, reason: 'malformed' };
  if (fields.domain !== host) return { ok: false, reason: 'domain' };
  try {
    if (new URL(fields.uri).host !== host) return { ok: false, reason: 'domain' };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (fields.chainId !== base.id) return { ok: false, reason: 'chain' };
  const issuedAt = fields.issuedAt?.getTime();
  if (!issuedAt || Math.abs(now - issuedAt) > MAX_AGE_MS) return { ok: false, reason: 'expired' };
  if (!validateSiweMessage({ message: fields, domain: host, time: new Date(now) })) return { ok: false, reason: 'expired' };
  return { ok: true, wallet: fields.address.toLowerCase(), nonce: fields.nonce };
}

export async function verifySiweSignature(message: string, signature: string, wallet: string): Promise<boolean> {
  if (!/^0x[0-9a-fA-F]+$/.test(signature) || signature.length > 20_000) return false;
  try {
    const recovered = await recoverMessageAddress({ message, signature: signature as Hex });
    if (isAddressEqual(recovered, wallet as Hex)) return true;
  } catch {
    // Not a plain 65-byte signature: try the smart-wallet path.
  }
  try {
    return await client.verifySiweMessage({ message, signature: signature as Hex, address: wallet as Hex });
  } catch {
    return false;
  }
}
