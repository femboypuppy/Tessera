# Self-hosting

The Tessera server syncs workspaces between devices and people, and serves the web app. It is one
container with one volume: SQLite for documents and accounts, and a folder for attachments.

## What you need

- A machine with Docker: a small VPS, a home server or a NAS. 1 CPU and 1 GB of RAM are plenty
  for a team.
- A domain name and HTTPS if people will connect over the internet.
  [Caddy does HTTPS for you](./https).
- Images for `linux/amd64` and `linux/arm64` (Raspberry Pi 4 and newer, Apple silicon, ARM VPSs).

## Quick start

```bash
docker run -d --name tessera -p 8787:8787 -v tessera-data:/data ghcr.io/femboypuppy/tessera:latest
```

Open `http://localhost:8787`. The first visit shows a setup form that creates the **owner**
account. Prefer the command line? Run:

```bash
docker exec -it tessera tessera-server create-owner
```

## Docker Compose (recommended)

Compose keeps your settings in a file, restarts the server after a reboot and makes upgrades one
command.

```bash
mkdir tessera && cd tessera
curl -fsSLO https://raw.githubusercontent.com/femboypuppy/Tessera/main/docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/femboypuppy/Tessera/main/.env.example -o .env
```

Edit `.env`: at least set `PUBLIC_URL` to the address people will use. Then:

```bash
docker compose up -d
docker compose logs -f tessera
```

The compose file also contains an optional **Caddy** service that gets a Let's Encrypt
certificate for your domain automatically. The comments in `docker-compose.yml` show how to turn
it on; [HTTPS and reverse proxies](./https) explains the options.

Every setting is listed in the [configuration reference](./configuration).

## Invite people

Sign in as the owner, open **Settings → Sync & account**, and create an invite link with a role
(editor or viewer). Whether people can also sign up on their own is up to you: see
`SIGNUP_MODE` in the [configuration reference](./configuration#signup_mode).

## Check that it works

- `https://<your-domain>/api/health` returns `{"ok":true,"version":"…"}`.
- The container reports `healthy` in `docker ps`.
- In the app, the sync indicator shows **Synced**.

## Hosting platforms

Step-by-step guides for a VPS with Docker and Caddy, Fly.io, Railway and Render are in the
[`deploy/` folder](https://github.com/femboypuppy/Tessera/tree/main/deploy) of the repository.

## Keep it safe

- Put the server behind HTTPS before anyone signs in over the internet.
- Set `SIGNUP_MODE` to `invite` (or `closed`) unless you really want open sign-ups.
- [Back up](./backups) the data volume, and test a restore once.
- [Upgrade](./upgrading) when a release fixes a security issue; watch the repository's releases to
  hear about them.

## Next

- [Configuration reference](./configuration)
- [HTTPS and reverse proxies](./https)
- [Backups and restore](./backups)
- [Upgrading](./upgrading)
