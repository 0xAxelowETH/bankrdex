import { issueNonce } from '../../../../../src/server/social';
import { failure, json } from '../../../../../src/server/socialHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A one-time nonce for the Sign-In with Ethereum message (valid 10 minutes).
export async function GET() {
  try {
    return json({ nonce: await issueNonce() });
  } catch (error) {
    return failure(error);
  }
}
