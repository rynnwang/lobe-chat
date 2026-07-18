# Deploying this fork to a small VPS (Debian 12, 1 GB RAM, 5 GB SSD)

An alternative to [`CLOUDFLARE_SETUP.md`](CLOUDFLARE_SETUP.md) for when Cloudflare Pages'
free-tier per-function size limit (see the note in that file) isn't worth fighting. This
runs the full app as a normal Docker container on your own box — no bundle-size ceiling,
since it's not split into edge functions at all. Cloudflare Access still works exactly the
same way as a front door; it protects a hostname behind Cloudflare's proxy regardless of
what's actually running at the origin.

Like `CLOUDFLARE_SETUP.md`, this is a manual, dashboard/terminal-driven guide — nothing here
is committed to the repo as infrastructure-as-code, so you can see and change every step.

## Why this fits a 1 GB / 5 GB box

- The Docker image is **built in GitHub Actions**, not on the VPS. `next build` for this
  app needs several GB of RAM at build time (`NODE_OPTIONS=--max-old-space-size=8192` in the
  `Dockerfile`) — that would OOM on a 1 GB VPS. The VPS only ever `docker pull`s a
  pre-built image and runs it.
- The `Dockerfile` already uses Next.js's `standalone` output — the final runtime image only
  contains the compiled server + traced dependencies, not the full `node_modules` or source.
- This deployment stays in **client-side storage mode** (same as the Cloudflare path) — no
  Postgres container alongside it. A real database adds enough memory/complexity that it's
  not a good fit for 1 GB RAM; revisit that later if you get a bigger box.

Even so, 1 GB is tight. Budget roughly: OS + sshd \~150–300 MB, Docker Engine \~100–200 MB,
the app at idle/light personal use \~150–300 MB. Add swap (step 3) as a safety net.

## 1. Publish the image (GitHub Actions — already set up)

`.github/workflows/docker.yml` in this repo builds and pushes to **GitHub Container
Registry** (`ghcr.io/rynnwang/lobe-chat`) on every push to `main`, using the repo's built-in
`GITHUB_TOKEN` — no Docker Hub account or extra secrets needed. It'll run automatically the
next time you push/merge to `main`; you can also trigger it manually from the repo's
**Actions** tab → **Publish Docker Image** → **Run workflow**.

**One-time step**: GitHub Container Registry publishes images as **private** by default,
tied to your account. Make it public so the VPS can `docker pull` without authenticating:
your GitHub profile → **Packages** → `lobe-chat` → **Package settings** → **Change
visibility** → **Public**. (Nothing sensitive is in the image — it's just compiled code;
actual secrets are injected as environment variables at container-run time, not baked in.)

If you'd rather keep it private, `docker login ghcr.io` on the VPS with a
[personal access token](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#authenticating-to-the-container-registry) that has `read:packages` scope instead of the public-visibility step above.

## 2. Provision the VPS

Any Debian 12 VPS works. Once you have SSH access as a non-root user with `sudo`:

```bash
sudo apt update && sudo apt upgrade -y
```

Install Docker Engine (Debian's official instructions, using Docker's own apt repo for a
current version):

```bash
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
```

Log out and back in for the group change to apply, then confirm with `docker ps`.

## 3. Add swap (recommended on 1 GB RAM)

A small safety net so a memory spike gets slowed down by swapping instead of the OOM killer
picking a process to kill:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

(2 GB swap uses 2 GB of your 5 GB disk — if that's too tight, use `1G` instead.)

## 4. Run the container

Create a `.env` file (e.g. `~/lobe-chat/.env`) with your configuration — same variables as
the Cloudflare guide:

```
ACCESS_CODE=a-long-random-password
OPENAI_API_KEY=sk-...
# ...whichever provider keys or *_PROXY_URL overrides you use, see
# docs/self-hosting/environment-variables/model-provider.mdx and the
# "Using a MaaS / proxy platform" section of CLOUDFLARE_SETUP.md
```

Then pull and run:

```bash
docker pull ghcr.io/rynnwang/lobe-chat:latest
docker run -d \
  --name lobe-chat \
  --restart unless-stopped \
  --memory 700m \
  -p 127.0.0.1:3210:3210 \
  --env-file ~/lobe-chat/.env \
  ghcr.io/rynnwang/lobe-chat:latest
```

Notes:

- `--memory 700m` caps the container so a runaway process gets killed before it can take
  down the whole 1 GB VPS (including SSH) — adjust if you see it getting OOM-killed under
  normal use.
- `-p 127.0.0.1:3210:3210` binds only to localhost — the app is **not** reachable from the
  public internet directly. Cloudflare (step 6) is the only public entry point, which is
  what makes the firewall step (step 7) effective.

**Updating later**: `docker pull ghcr.io/rynnwang/lobe-chat:latest && docker stop lobe-chat && docker rm lobe-chat`, then re-run the `docker run` command above. Prune old images
occasionally so they don't fill the 5 GB disk: `docker image prune -a`.

## 5. Point a domain at the VPS

In Cloudflare DNS for your domain, add an **A record** to the VPS's public IP, with the
proxy status **On** (orange cloud) — this is what routes traffic through Cloudflare instead
of straight to your VPS.

Cloudflare dashboard → **SSL/TLS** → set the encryption mode to **Flexible** (Cloudflare
terminates HTTPS for visitors, talks plain HTTP to your origin on port 3210/80 — simplest,
no certificate to manage on the VPS). If you want end-to-end encryption instead, use **Full
(strict)** with a free [Cloudflare Origin CA
certificate](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/) and a
lightweight reverse proxy like Caddy in front of the container — more setup, skip it unless
you specifically want it.

## 6. Lock it down with Cloudflare Access

Identical to the Cloudflare Pages guide — Access protects the hostname, not the hosting
platform:

1.  Cloudflare dashboard → **Zero Trust** → **Access** → **Applications** → **Add an
    application** → **Self-hosted**.
2.  **Application domain**: the domain you pointed at the VPS in step 5.
3.  **Identity providers**: built-in **One-time PIN** (no setup needed).
4.  **Policies**: action **Allow**, rule **Emails** → your email address.
5.  Save. The domain now prompts for email + one-time code before reaching the app.

## 7. Firewall: only accept traffic from Cloudflare

Since DNS proxying alone doesn't stop someone who finds your VPS's raw IP from bypassing
Cloudflare Access entirely, restrict the firewall to Cloudflare's own IP ranges plus SSH:

```bash
sudo apt install -y ufw
sudo ufw default deny incoming
sudo ufw allow OpenSSH
for ip in $(curl -s https://www.cloudflare.com/ips-v4); do sudo ufw allow from "$ip" to any port 80,443 proto tcp; done
for ip in $(curl -s https://www.cloudflare.com/ips-v6); do sudo ufw allow from "$ip" to any port 80,443 proto tcp; done
sudo ufw enable
```

(This matters less if you followed step 4's advice to bind the container to `127.0.0.1`
only — that already blocks direct external access to port 3210. This step additionally
protects port 80/443 if you later add a reverse proxy per step 5's "Full (strict)" option.)

Re-run the Cloudflare IP loop periodically (or script it) — Cloudflare's IP ranges change
occasionally.

## What's different from the Cloudflare Pages path

- No edge-function size limit — the whole app runs as one normal server process, so none of
  the Clerk-route/bundle-size work from `CLOUDFLARE_SETUP.md` matters here (those routes
  were removed for a different reason anyway — Clerk isn't used regardless of hosting).
- Still client-side storage mode (browser IndexedDB) for the same reason as the Cloudflare
  path: adding a real Postgres database is a bigger change than either guide covers, and
  doesn't comfortably fit in 1 GB RAM alongside the app itself.
- Cloudflare Access setup is identical either way — it's independent of where the app
  actually runs.
