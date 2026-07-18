import { NextResponse } from 'next/server';

// node:dns / the `ip` package aren't available on the Edge Runtime, so private-network
// access is blocked by hostname/literal-IP pattern instead of a resolved-IP lookup.
// Cloudflare's own fetch() implementation additionally refuses to reach private/internal
// IP ranges from a Worker, so this is defense-in-depth rather than the only guard.
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^0\.0\.0\.0$/,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./, // link-local, incl. cloud metadata endpoints
  /^\[?::1]?$/,
  /^\[?fe80:/i,
  /^\[?f[cd][\da-f]{2}:/i, // unique local addresses (fc00::/7)
];

const isPrivateHost = (hostname: string) =>
  PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname));

/**
 * just for a proxy
 */
export const POST = async (req: Request) => {
  const url = new URL(await req.text());

  if (isPrivateHost(url.hostname))
    return NextResponse.json({ error: 'Not support internal host proxy' }, { status: 400 });

  const res = await fetch(url.toString());

  return new Response(res.body, { headers: res.headers });
};
