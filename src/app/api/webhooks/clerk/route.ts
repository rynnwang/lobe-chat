import { NextResponse } from 'next/server';

import { authEnv } from '@/config/auth';
import { isServerMode } from '@/const/version';
import { pino } from '@/libs/logger';

import { validateRequest } from './validateRequest';

if (authEnv.NEXT_PUBLIC_ENABLE_CLERK_AUTH && isServerMode && !authEnv.CLERK_WEBHOOK_SECRET) {
  throw new Error('`CLERK_WEBHOOK_SECRET` environment variable is missing');
}

// Clerk isn't wired up in this deployment (Cloudflare Access handles auth instead).
// `@/server/services/user` pulls in the Postgres server DB driver, which isn't available
// on the Edge Runtime. The check has to be the literal `process.env.NEXT_PUBLIC_*`
// expression (not the wrapped `authEnv` getter) so Next's build-time inlining can dead-code
// eliminate the whole disabled branch, instead of just skipping it at runtime.
const handlePost = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  ? async (req: Request): Promise<NextResponse> => {
      const payload = await validateRequest(req, authEnv.CLERK_WEBHOOK_SECRET!);

      if (!payload) {
        return NextResponse.json(
          { error: 'webhook verification failed or payload was malformed' },
          { status: 400 },
        );
      }

      const { type, data } = payload;

      pino.trace(`clerk webhook payload: ${{ data, type }}`);

      const { UserService } = await import('@/server/services/user');
      const userService = new UserService();
      switch (type) {
        case 'user.created': {
          return userService.createUser(data.id, data);
        }
        case 'user.deleted': {
          return userService.deleteUser(data.id);
        }
        case 'user.updated': {
          return userService.updateUser(data.id, data);
        }

        default: {
          pino.warn(
            `${req.url} received event type "${type}", but no handler is defined for this type`,
          );
          return NextResponse.json(
            { error: `unrecognised payload type: ${type}` },
            { status: 400 },
          );
        }
      }
    }
  : async (): Promise<NextResponse> =>
      NextResponse.json({ error: 'Clerk auth is not enabled' }, { status: 404 });

export const POST = handlePost;
