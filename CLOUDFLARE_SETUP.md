# Deploying this fork to Cloudflare Workers

This is a manual, dashboard-driven setup guide. It does commit one Cloudflare-specific
config file, `wrangler.jsonc` — unlike the rest of this repo, that one genuinely can't be
avoided (it's how a Worker knows its own name, compatibility settings, and asset bindings;
there's no dashboard-only equivalent). Everything else — environment variables, secrets, the
Access policy that actually locks the app down — stays in the dashboard, so you can see and
change it yourself.

> **Revision note**: this guide originally targeted Cloudflare Pages with
> `@cloudflare/next-on-pages`. That tool turned out to be deprecated, and its build-time
> "exceeds maximum edge function size" check is a hardcoded \~4 MB limit baked into the tool
> itself — it doesn't check your actual Cloudflare plan at all, which is why upgrading to
> Workers Paid didn't fix anything. Cloudflare's current recommended path is **OpenNext for
> Cloudflare** (`@opennextjs/cloudflare`), deploying to real Cloudflare Workers instead of
> Pages Functions — that's what this version of the guide covers. It does respect your
> actual plan's limit (10 MiB gzip on Workers Paid, which this app should fit; the free
> plan's 3 MiB is a closer call given the bundle-size findings in the old version of this
> file — Workers Paid is the safer bet, and you already have it).
>
> One consequence of that switch: every route that was previously converted to
> `export const runtime = 'edge'` (for `next-on-pages`, which required _everything_ to be
> edge) got reverted back to the default Node.js runtime. OpenNext works the opposite way —
> it bundles the whole app as one Node.js-compatible Worker via `nodejs_compat`, and treats
> edge-runtime routes as a special case requiring separate bundling it doesn't do
> automatically (`OpenNext requires edge runtime function to be defined in a separate
function` was the actual build error this produced). None of the earlier edge-compatibility
> work was wasted, though — the underlying fixes (the `pg` webpack alias, the bundled-import
> i18n loader instead of `node:fs`, the hostname-based proxy SSRF guard instead of
> `node:dns`) are still correct and still needed, since Workers itself — regardless of which
> Next.js runtime a route declares — still can't do real DNS lookups or open raw TCP sockets
> to a Postgres server.

## What this deployment is

- **Compute**: a single Cloudflare Worker (Workers Paid plan — $5/mo, 10 MiB gzip limit).
  Unlike the old Pages approach, OpenNext bundles the whole app into one Worker rather than
  one function per page, so there's no more per-route size chasing.
- **Storage mode**: client-side only, same as before. Chats, settings, and uploaded files
  live in your browser's IndexedDB — no server database. Cloudflare's own free database (D1)
  is SQLite, which this codebase's schema doesn't support; a real Postgres server DB (e.g.
  [Neon](https://neon.tech)'s free HTTP-compatible tier) is a bigger change than this guide
  covers.
- **Auth**: two layers — **Cloudflare Access** (Zero Trust) in front of the whole site as the
  real front door, plus the built-in **`ACCESS_CODE`** as a secondary gate on chat/LLM API
  calls specifically (not a full login wall on its own — don't rely on it alone).

Because there's no server database, this is single-browser storage: chat history won't sync
between devices automatically. LobeChat has a built-in WebRTC sync feature for that
(peer-to-peer, no server) — see
[docs/self-hosting/advanced/webrtc.mdx](docs/self-hosting/advanced/webrtc.mdx) if you want it.

**Local verification caveat**: OpenNext's own CLI [warns it isn't fully compatible with
Windows](https://opennext.js.org/cloudflare) (symlink handling during Next.js's standalone
build step needs either admin rights or Developer Mode enabled), so I could type-check and
regular-build this fork on my end, but couldn't complete a full local OpenNext build to
verify end-to-end. Cloudflare's own Linux build servers don't have that limitation, but this
means the actual Cloudflare build is the first full test of this specific path — expect to
paste me the build log if something doesn't work.

## 1. Push this branch to GitHub

Cloudflare Workers Builds deploys from a GitHub (or GitLab) repo, same as Pages did. Push
your fork/branch so it's available to connect in the next step.

## 2. Create the Worker project

1.  Cloudflare dashboard → **Workers & Pages** → **Create** → **Workers** (not Pages this
    time) → **Import a repository** / **Connect to Git**.
2.  Pick this repository.
3.  Since `wrangler.jsonc` is already committed, Cloudflare should detect it and use its
    settings (name, compatibility date/flags, asset bindings) automatically — you shouldn't
    need to fill those in by hand the way the old Pages guide required.
4.  **Build command**: `pnpm run cf:build`
5.  **Deploy command**: `pnpm exec wrangler deploy` (or `pnpm exec opennextjs-cloudflare deploy` — either works; the package.json `cf:deploy` script chains build+deploy in one command if the dashboard only exposes a single command field instead of separate build/deploy ones).

> **Why `--dangerouslyUseUnsupportedNextVersion` is in `cf:build`**: this fork is on Next.js
> 14, which is outside Next's own 2-year support window as of now. OpenNext's CLI refuses to
> build against an unsupported Next version unless you pass that flag. It's a real signal
> worth knowing about, not just noise to silence — Next 14 not receiving security patches is
> a legitimate reason to eventually upgrade to Next 15, just not something folded into this
> Cloudflare deployment work.

> **Why `cf:build` also sets `NODE_OPTIONS=--max-old-space-size=4096`**: the first real build
> on Cloudflare's Workers Builds container OOM'd partway through `next build` itself —
> `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory` around
> the \~2 GB mark, which is roughly Node's un-tuned default heap ceiling. The existing
> `Dockerfile` already works around the same underlying issue the same way (it sets
> `NODE_OPTIONS=--max-old-space-size=8192` for its build stage) — 4096 here is a guess at a
> value that fits Workers Builds' container without getting OOM-killed by the container
> itself before V8 even hits its own limit; I couldn't verify the container's actual memory
> ceiling from outside it. If this build still fails with a heap or memory error, try a lower
> number (e.g. 3072) in case the container has less than 4 GB; if it fails silently with no
> V8 error at all (just a killed process), that's the container's own OOM killer, and
> trimming unused AI-provider SDKs from `package.json` is the fallback (this fork bundles
> \~20 providers; you likely only use a couple).

## 3. Environment variables

Worker → **Settings** → **Variables and Secrets**. Use **Secret** (not plain **Variable**)
for anything sensitive — same effect on `process.env`, just encrypted at rest.

| Variable       | Value                  | Why                                                                            |
| -------------- | ---------------------- | ------------------------------------------------------------------------------ |
| `ACCESS_CODE`  | a long random password | Secondary gate on chat API calls. Generate one with `openssl rand -base64 24`. |
| `NODE_VERSION` | `22.11.0`              | Matches `.nvmrc` — see the gotcha below, same issue applies to Workers Builds. |

> **Node version gotchas**: `.nvmrc` originally said `lts/iron`, an `nvm`-style alias.
> Cloudflare's build image uses `asdf`/`node-build`, which doesn't understand that alias and
> fails outright (`node-build: definition not found: 20`) before installing anything —
> `.nvmrc` needs a concrete `X.Y.Z` version, not an alias. Separately, `.nvmrc` needs to be on
> **Node 22+, not just any concrete version**: `wrangler deploy` (the deploy command from
> step 2) refused to run under Node 20 with `Wrangler requires at least Node.js v22.0.0`, even
> though the build step itself was fine on 20. Since the build and deploy commands share the
> same container/Node version, `.nvmrc` has to satisfy both — it's pinned to `22.11.0` now.

Then add API keys for whichever model providers you actually use, e.g. `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `GOOGLE_API_KEY` (or enter them per-provider in the app's Settings UI
instead — stored in your browser only; env vars just save you re-entering them). Full list:
[docs/self-hosting/environment-variables/model-provider.mdx](docs/self-hosting/environment-variables/model-provider.mdx).

### Using a MaaS / proxy platform instead of the official APIs

If you're routing through a MaaS or proxy platform (one token per platform, custom base URL)
instead of calling OpenAI/Google/Anthropic directly, each provider has a `*_PROXY_URL`
variable that overrides its default base URL — the API key variable becomes that platform's
token instead of an official one:

| Variable              | Value                                                            |
| --------------------- | ---------------------------------------------------------------- |
| `OPENAI_API_KEY`      | your MaaS platform's token for the OpenAI-compatible endpoint    |
| `OPENAI_PROXY_URL`    | e.g. `https://your-maas-platform.example.com/api/v1`             |
| `GOOGLE_API_KEY`      | your MaaS platform's token for the Gemini-compatible endpoint    |
| `GOOGLE_PROXY_URL`    | e.g. `https://your-maas-platform.example.com/api`                |
| `ANTHROPIC_API_KEY`   | your MaaS platform's token for the Anthropic-compatible endpoint |
| `ANTHROPIC_PROXY_URL` | e.g. `https://your-maas-platform.example.com/api/anthropic`      |

Double-check whether your proxy expects a `/v1` suffix or not — see the callout in the docs
link above; mismatched suffixes are the most common cause of empty responses.

**Model names**: since a MaaS platform's model catalog won't match the official provider's:

- **OpenAI-compatible**: set `OPENAI_MODEL_LIST`, e.g. `-all,+your-model-name` to clear the
  default list and add just the one(s) your platform serves.
- **Google/Anthropic-compatible**: no equivalent `*_MODEL_LIST` env var in this codebase —
  add the custom model directly in the app itself (Settings → the provider → add a custom
  model ID) after you deploy.

Do **not** set `NEXT_PUBLIC_SERVICE_MODE` — leaving it unset keeps the app in client-side
storage mode, which this whole setup assumes.

## 4. Deploy

Save and trigger a build (push to the branch, or use the dashboard's manual deploy button).
Cloudflare will build and give you a `<worker-name>.<subdomain>.workers.dev` URL.

## 5. Lock it down with Cloudflare Access

Same as before — this is the step that actually makes the deployment private. Free for up
to 50 users, and works identically regardless of what's running at the origin:

1.  Cloudflare dashboard → **Zero Trust** → **Access** → **Applications** → **Add an
    application** → **Self-hosted**.
2.  **Application domain**: your `*.workers.dev` URL from step 4 (or a custom domain — see
    step 6).
3.  **Identity providers**: built-in **One-time PIN** works with no setup (emails a login
    code to an address you approve).
4.  **Policies**: action **Allow**, rule **Emails** → your email address.
5.  Save. Visiting the Worker's URL now prompts for email + a one-time code before LobeChat
    loads at all.

## 6. Custom domain (optional)

Worker → **Settings** → **Domains & Routes** → **Add** → **Custom Domain**. Update the
Access application's domain (step 5.2) to match if you do this.

## What's intentionally out of scope

- **Multi-user accounts / SSO** (NextAuth, Clerk): not configured. Cloudflare Access is the
  auth layer instead. NextAuth's code paths are still in the repo (edge-runtime-safe, in
  case you want them later) but no provider env vars are set, so they're inert. Clerk's
  UI-heavy pages were removed entirely (`src/app/(auth)/*`,
  `src/app/(main)/profile/[[...slugs]]/*`) since they were dead code either way.
- **Server-side file storage (S3/R2)**: uploaded files stay in your browser's IndexedDB.
  Fine for single-device personal use; won't show up on a second device.
- **Server database / multi-device sync**: see the WebRTC sync note above, or the Neon note
  in "What this deployment is" if you want to revisit this later.
- **R2-backed incremental cache**: `open-next.config.ts` doesn't configure one. This app is
  mostly dynamically rendered (chat), so ISR/on-demand revalidation caching isn't a big win
  here — OpenNext's default in-memory cache is enough. Revisit if you add heavily-cached
  static content later.

## Notes on this fork specifically

This fork's `.npmrc` originally shipped with `lockfile=false` (upstream's policy, so every
install always grabs the newest compatible package versions). Combined with no committed
`pnpm-lock.yaml`, that meant a plain `pnpm install` silently pulled in several incompatible
package versions and broke the build in several different ways. I removed `lockfile=false`
and committed a `pnpm-lock.yaml` so Cloudflare's build (and your local builds) always get the
exact dependency versions that were actually tested — **don't delete the lockfile**, and if
you ever want to intentionally pick up newer versions of something, do it deliberately
(`pnpm update <package>`) rather than by deleting the lockfile.
