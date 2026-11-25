import { readSession } from '../../../../src/server/session';
import { isUsernameFree, usernameProblem } from '../../../../src/server/social';
import { failure, json } from '../../../../src/server/socialHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ?u=<username> → { available, reason? } for the profile form.
export async function GET(request: Request) {
  const username = (new URL(request.url).searchParams.get('u') ?? '').trim().replace(/^@/, '').toLowerCase();
  const problem = usernameProblem(username);
  if (problem) return json({ available: false, reason: problem });
  try {
    const available = await isUsernameFree(username, readSession(request)?.wallet);
    return json({ available, reason: available ? undefined : 'That username is taken.' });
  } catch (error) {
    return failure(error);
  }
}
