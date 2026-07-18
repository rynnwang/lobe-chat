import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import type { NextRequest } from 'next/server';

import { pino } from '@/libs/logger';
import { createContext } from '@/server/context';

// `@/server/routers/lambda` pulls in the Postgres server DB driver, which can't make
// real TCP connections inside the Workers runtime regardless of Next.js runtime target
// (see the `pg` alias in next.config.mjs). This deployment runs in client-side storage
// mode (NEXT_PUBLIC_SERVICE_MODE unset), so that router is never imported at all here —
// the ternary on the literal env var lets the bundler drop the whole DB-backed branch.
const handler: (req: NextRequest) => Promise<Response> =
  process.env.NEXT_PUBLIC_SERVICE_MODE === 'server'
    ? async (req: NextRequest) => {
        const { lambdaRouter } = await import('@/server/routers/lambda');

        return fetchRequestHandler({
          /**
           * @link https://trpc.io/docs/v11/context
           */
          createContext: () => createContext(req),

          endpoint: '/trpc/lambda',

          onError: ({ error, path, type }) => {
            pino.info(`Error in tRPC handler (lambda) on path: ${path}, type: ${type}`);
            console.error(error);
          },

          req,
          router: lambdaRouter,
        });
      }
    : async () =>
        new Response('Server database mode is not enabled in this deployment.', { status: 404 });

export { handler as GET, handler as POST };
