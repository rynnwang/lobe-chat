// The Node adapter (@/libs/next-auth) pulls in the Postgres server DB driver, which
// this deployment can't use (no server DB in the Workers runtime — see the `pg` alias
// in next.config.mjs). This deployment doesn't use the DB session adapter (client-side
// storage mode), so the DB-free "edge" variant is equivalent here regardless of runtime.
import NextAuthEdge from '@/libs/next-auth/edge';

export const { GET, POST } = NextAuthEdge.handlers;
