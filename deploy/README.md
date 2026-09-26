# Self-hosting Tessera

Tessera's server is one container: it syncs your workspaces in real time, stores them in SQLite,
and serves the web app. Your notes also live on every device that uses them, so the server is
never the only copy.

| You have | Follow |
|---|---|
| A Linux server or VPS with Docker | [VPS with Docker and Caddy](vps/README.md) (recommended) |
| A Fly.io account | [Fly.io](fly/README.md) |
| A Railway account | [Railway](railway/README.md) |
| A Render account | [Render](render/README.md) |
| Unraid, CasaOS or Umbrel | [App-store templates](appstores/README.md) |

Then: [back up and restore](backup/README.md), and [upgrade between versions](UPGRADING.md).

## The quick version

```bash
mkdir tessera && cd tessera
curl -fsSLO https://raw.githubusercontent.com/femboypuppy/Tessera-Notes/main/docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/femboypuppy/Tessera-Notes/main/.env.example -o .env
mkdir -p deploy/caddy && curl -fsSL https://raw.githubusercontent.com/femboypuppy/Tessera-Notes/main/deploy/caddy/Caddyfile -o deploy/caddy/Caddyfile
nano .env                                   # PUBLIC_URL, and TESSERA_DOMAIN for HTTPS
docker compose --profile https up -d        # or `docker compose up -d` without Caddy
docker compose exec tessera tessera-server create-owner
```

Open `PUBLIC_URL`, sign in as the owner, and invite people from Settings.

## What runs

- **`tessera`**: the image `ghcr.io/femboypuppy/tessera` (amd64 and arm64), built from the
  repository's `Dockerfile`: Node 24 on Alpine, about 60 MB compressed, running as an
  unprivileged user (`node`, uid 1000) with a read-only root filesystem. It listens on port
  8787 and answers `GET /api/health` (the container's health check).
- **`caddy`** (profile `https`): Caddy 2 in front, with a Let's Encrypt certificate for
  `TESSERA_DOMAIN`, HTTP/3 and compression. WebSockets (real-time sync) pass through.
- **Volumes**: `tessera-data` holds everything (`/data`: the database and attachments);
  `caddy-data` holds the certificates.

## Settings

Set them in `.env` (read by `docker-compose.yml`) or as environment variables on your platform.
The server documents every variable in [`apps/server/README.md`](../apps/server/README.md).

| Variable | Default | Meaning |
|---|---|---|
| `PUBLIC_URL` | `http://localhost:8787` | The address people use (invite links, the desktop app). |
| `SIGNUP_MODE` | `invite` | `invite`, `open` or `closed`. |
| `MAX_UPLOAD_MB` | `25` | Largest attachment. |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`. |
| `DATA_DIR` | `/data` | Where the server stores data (keep it on the volume). |
| `PORT` | `8787` | The port inside the container (platforms like Render set it). |
| `TESSERA_VERSION` | `latest` | Image tag in `docker-compose.yml`. Pin a release in production. |
| `TESSERA_PORT`, `TESSERA_BIND` | `8787`, `0.0.0.0` | Where Compose publishes the port on the host. |
| `TESSERA_DOMAIN` | | Your domain, for the `https` profile. |

## Requirements

- 1 CPU and 512 MB of RAM are plenty for a team; SQLite and Node use little.
- Disk: the database plus your attachments. Start with 1 GB.
- A domain name for HTTPS (browsers and the desktop app need HTTPS off `localhost`).
- One instance per data volume. SQLite has one writer; don't scale the service to several
  replicas over one volume.

## Check that it works

```bash
docker compose ps                          # tessera should be "healthy"
curl -fsS http://localhost:8787/api/health # {"ok":true,...}
docker compose logs -f tessera
```

Developers can run the container smoke test from a checkout (Node 24 and Docker):
`node deploy/smoke/smoke-test.mjs --build`. It starts the image like Compose does, creates the
owner, syncs a document, restarts the container and checks the document survived.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `permission denied` under `/data` on a platform volume | The platform mounts volumes owned by root. Start the container as root (see your platform's guide): the entrypoint hands `/data` to the app user and drops privileges. |
| Caddy can't get a certificate | DNS must point `TESSERA_DOMAIN` at the server and ports 80 and 443 must be open. `docker compose logs caddy` says why. |
| The desktop app can't connect | `PUBLIC_URL` must be the exact address you type in the app, with `https://`. |
| Container restarts in a loop | `docker compose logs tessera`: the server explains invalid settings at startup. |
