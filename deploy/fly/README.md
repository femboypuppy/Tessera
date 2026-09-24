# Tessera on Fly.io

A single machine with a volume, HTTPS on `<app>.fly.dev` or your own domain. About $3 to $5 a
month for a small team (a shared CPU, 512 MB, a 1 GB volume).

## 1. Install flyctl and sign in

```bash
curl -L https://fly.io/install.sh | sh
fly auth login
```

## 2. Create the app

From a checkout of the repository (or just this folder's `fly.toml` and `Dockerfile`):

```bash
cd deploy/fly
fly launch --copy-config --no-deploy --name my-tessera --region ams
```

Pick a name and the region closest to you. `fly launch` keeps this `fly.toml` and only fills in
the name.

## 3. Create the volume

```bash
fly volumes create tessera_data --size 1 --region ams
```

Use the same region as the app. Fly mounts it at `/data`.

## 4. Set the public URL

```bash
fly secrets set PUBLIC_URL=https://my-tessera.fly.dev
```

(It isn't secret, but secrets are the quickest way to set a variable without editing `fly.toml`.)

## 5. Deploy

```bash
fly deploy
fly status            # one machine, health check passing
fly logs
```

## 6. Create the owner

```bash
fly ssh console -C "su-exec node tessera-server create-owner"
```

Then open `https://my-tessera.fly.dev` and sign in.

## Your own domain

```bash
fly certs add notes.example.com
```

Create the DNS records it prints, then update `PUBLIC_URL`:
`fly secrets set PUBLIC_URL=https://notes.example.com`.

## Backups

Fly snapshots volumes daily and keeps them five days. Take one before upgrades:

```bash
fly volumes list
fly volumes snapshots create <volume-id>
```

For copies off Fly, run `tessera-server backup` over `fly ssh console` and download the file with
`fly ssh sftp get`.

## Notes

- **One machine.** Don't `fly scale count 2`: each machine would get its own volume and database.
- **Why the extra Dockerfile.** Fly mounts volumes owned by root, and the image runs as an
  unprivileged user. `USER root` lets the image's entrypoint fix `/data` once; the server itself
  still runs as `node`.
- **Upgrades.** Change the tag in `Dockerfile` (`FROM ghcr.io/femboypuppy/tessera:0.2.0`) and
  `fly deploy`. See [UPGRADING.md](../UPGRADING.md).
