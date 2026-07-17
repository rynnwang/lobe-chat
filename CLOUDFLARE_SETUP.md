# Deploying this fork to Cloudflare (free tier)

This is a manual, dashboard-driven setup guide — there's no `wrangler.toml`/`wrangler.jsonc`
in this repo on purpose. Everything below is configured by hand in the Cloudflare dashboard,
so you can see and change every setting yourself.

## What this deployment is

- **Compute**: Cloudflare Pages (Functions run on Workers, free tier: 100,000 requests/day).
- **Storage mode**: client-side only. Chats, settings, and uploaded files live in your
  browser's IndexedDB — there's no server database. This keeps the whole stack inside
  Cloudflare's free tier: LobeChat's server-DB mode needs Postgres, and Cloudflare's own
  free database (D1) is SQLite, which this codebase's schema doesn't support. If you later
  want a real server DB, [Neon](https://neon.tech) has a free Postgres tier that works over
  HTTP (edge-compatible) — that's a bigger change than this guide covers.
- **Auth**: two layers —
  1.  **Cloudflare Access** (Zero Trust) sits in front of the whole site and blocks anyone
      who isn't you before the app even loads. This is the real front door.
  2.  **`ACCESS_CODE`** (built into LobeChat) is a secondary password gate on the chat/LLM
      API calls themselves. It's not a full login wall on its own (see caveat below), so
      don't rely on it alone — Cloudflare Access is what actually makes this private.

Because there's no server database, this is single-browser storage: chat history won't
sync between your phone and laptop automatically. LobeChat has a built-in WebRTC sync
feature for that (peer-to-peer, no server) — see
[docs/self-hosting/advanced/webrtc.mdx](docs/self-hosting/advanced/webrtc.mdx) if you want it.

## 1. Push this branch to GitHub

Cloudflare Pages deploys from a GitHub (or GitLab) repo. Push your fork/branch so it's
available to connect in the next step.

## 2. Create the Pages project

1.  Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2.  Pick this repository.
3.  **Framework preset**: choose **Next.js**. Cloudflare auto-fills the build command
    (`npx @cloudflare/next-on-pages@1`) and output directory (`.vercel/output/static`) for
    this preset — leave those as-is.
4.  Package manager: Pages detects `pnpm` automatically from `pnpm-lock.yaml` and
    `packageManager` in `package.json`.

> **Heads-up on the build step**: `@cloudflare/next-on-pages` (the tool that converts the
> Next.js build into a Cloudflare Worker) can be memory-hungry on a large app like this one
> — it repeatedly ran out of memory when I tested it locally on Windows (a
> [documented limitation](https://github.com/cloudflare/next-on-pages) of that tool on
> Windows specifically). Cloudflare's own Linux build servers are usually fine with it, but
> **watch the first deploy's build log**. If it fails with an out-of-memory error there too,
> the fix is trimming unused AI-provider SDKs from `package.json` (this fork bundles \~20
> providers; you likely only use a couple) — ask me to do that if it comes up.

## 3. Environment variables

In the Pages project → **Settings** → **Environment variables**, add for **Production**
(and Preview, if you want preview deploys to work too):

| Variable       | Value                  | Why                                                                            |
| -------------- | ---------------------- | ------------------------------------------------------------------------------ |
| `ACCESS_CODE`  | a long random password | Secondary gate on chat API calls. Generate one with `openssl rand -base64 24`. |
| `NODE_VERSION` | `20`                   | Matches the Node version this repo targets (`.nvmrc` = `lts/iron`).            |

Then add API keys for whichever model providers you actually use, e.g.:

| Variable            | Notes                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`    | Optional — you can also enter your own key per-provider in the app's Settings UI instead (stored in your browser only). Env vars just save you from re-entering it. |
| `ANTHROPIC_API_KEY` | Same                                                                                                                                                                |
| `GOOGLE_API_KEY`    | Same                                                                                                                                                                |

Full list of supported provider variables:
[docs/self-hosting/environment-variables/model-provider.mdx](docs/self-hosting/environment-variables/model-provider.mdx).

### Using a MaaS / proxy platform instead of the official APIs

If you're routing through a MaaS or proxy platform (one token per platform, custom base
URL, e.g. a self-hosted gateway) instead of calling OpenAI/Google/Anthropic directly, each
provider has a `*_PROXY_URL` variable that overrides its default base URL — the API key
variable is then that platform's token instead of an official one. For example:

| Variable              | Value                                                            |
| --------------------- | ---------------------------------------------------------------- |
| `OPENAI_API_KEY`      | your MaaS platform's token for the OpenAI-compatible endpoint    |
| `OPENAI_PROXY_URL`    | `https://maas-openapi.wanjiedata.com/api/v1`                     |
| `GOOGLE_API_KEY`      | your MaaS platform's token for the Gemini-compatible endpoint    |
| `GOOGLE_PROXY_URL`    | `https://maas-openapi.wanjiedata.com/api`                        |
| `ANTHROPIC_API_KEY`   | your MaaS platform's token for the Anthropic-compatible endpoint |
| `ANTHROPIC_PROXY_URL` | `https://maas-openapi.wanjiedata.com/api/anthropic`              |

(Swap in your own MaaS provider's URLs/tokens — the `wanjiedata` ones above are just the
example you gave.) Double-check whether your proxy expects the `/v1` suffix or not — see
the callout in the docs link above; mismatched suffixes are the most common cause of empty
responses.

**Model names**: since a MaaS platform's model catalog won't match the official provider's,
you also need to tell LobeChat which model names exist:

- **OpenAI-compatible**: set `OPENAI_MODEL_LIST`, e.g. `-all,+your-model-name` to clear the
  default list and add just the one(s) your platform serves (comma-separated for more than
  one). Full syntax: the `OPENAI_MODEL_LIST` section of the docs link above.
- **Google/Anthropic-compatible**: there's no equivalent `*_MODEL_LIST` env var for these
  two providers in this codebase — add the custom model directly in the app itself
  (Settings → the provider → add a custom model ID) after you deploy.

Do **not** set `NEXT_PUBLIC_SERVICE_MODE` — leaving it unset keeps the app in client-side
storage mode, which is what this whole setup assumes.

### Compatibility flags

Still in Settings, under **Functions** → **Compatibility flags**, add `nodejs_compat` for
both Production and Preview, and set **Compatibility date** to a recent date (e.g. today's
date, or at least `2024-09-23`). Some dependencies (JWT/webhook signing libraries) expect a
couple of Node built-ins that this flag provides.

## 4. Deploy

Save and deploy. Cloudflare will build and give you a `<project>.pages.dev` URL.

## 5. Lock it down with Cloudflare Access

This is the step that actually makes the deployment private. Free for up to 50 users.

1.  Cloudflare dashboard → **Zero Trust** (left sidebar). First time here, it'll ask you to
    pick a team name — anything works, it's just a URL slug for your login page.
2.  **Access** → **Applications** → **Add an application** → **Self-hosted**.
3.  **Application domain**: your `<project>.pages.dev` domain (or your custom domain, if you
    add one later — see step 6).
4.  **Identity providers**: the built-in **One-time PIN** works out of the box with no setup
    — it emails a login code to an address you approve. (You can add Google/GitHub login
    later if you prefer.)
5.  **Policies** → add a policy, action **Allow**, rule **Emails** → your email address
    (`rynn.wang.my@outlook.com`, or whichever you want to use). This is the actual allowlist.
6.  Save. Now visiting your Pages URL prompts for that email + a one-time code _before_
    LobeChat loads at all.

## 6. Custom domain (optional)

Pages project → **Custom domains** → add a domain you manage in Cloudflare DNS. Update the
Access application's domain (step 5.3) to match if you do this.

## What's intentionally out of scope

- **Multi-user accounts / SSO** (NextAuth, Clerk): not configured. Cloudflare Access is the
  auth layer instead — it's simpler to run for one person and doesn't need you to register
  an OAuth app anywhere. The NextAuth code paths are still in the repo (edge-runtime-safe,
  in case you want them later) but no provider env vars are set, so they're inert.
- **Server-side file storage (S3/R2)**: uploaded files stay in your browser's IndexedDB.
  Fine for single-device personal use; won't show up on a second device.
- **Server database / multi-device sync**: see the WebRTC sync note above, or the Neon note
  in the "What this deployment is" section if you want to revisit this later.

## Notes on this fork specifically

This fork's `.npmrc` originally shipped with `lockfile=false` (upstream's policy, so every
install always grabs the newest compatible package versions). Combined with no committed
`pnpm-lock.yaml`, that meant a plain `pnpm install` silently pulled in several incompatible
package versions and broke the build in several different ways. I removed `lockfile=false`
and committed a `pnpm-lock.yaml` so Cloudflare's build (and your local builds) always get
the exact dependency versions that were actually tested — **don't delete the lockfile**, and
if you ever want to intentionally pick up newer versions of something, do it deliberately
(`pnpm update <package>`) rather than by deleting the lockfile.
