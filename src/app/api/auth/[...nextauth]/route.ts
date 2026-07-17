// The Node adapter (@/libs/next-auth) pulls in the Postgres server DB driver, which
// isn't available on the Edge Runtime. This deployment doesn't use the DB session
// adapter (client-side storage mode), so the edge-only variant is equivalent here.
import NextAuthEdge from '@/libs/next-auth/edge';

export const runtime = 'edge';

export const { GET, POST } = NextAuthEdge.handlers;
