# Tessera on Render

A web service with a persistent disk; Render provides HTTPS on `*.onrender.com`. Disks need a
paid instance (Starter or above).

## With the Blueprint

1. Fork the repository.
2. In Render: **New → Blueprint**, pick your fork, and set the **Blueprint path** to
   `deploy/render/render.yaml`.
3. Render asks for `PUBLIC_URL`: enter `https://<service-name>.onrender.com` (you can change it
   after adding your own domain).
4. **Apply**. The service builds `deploy/render/Dockerfile` (the published image) and mounts a
   1 GB disk at `/data`.
5. When the health check passes, open the service's **Shell** and run
   `su-exec node tessera-server create-owner`.

## By hand

**New → Web Service → Existing image** also works: image `ghcr.io/femboypuppy/tessera:latest`,
a disk at `/data`, health check path `/api/health`, and the variables from `render.yaml`. Render
mounts disks owned by root, so with the published image as is, the server can't write to
`/data`. Prefer the Blueprint (its Dockerfile starts the container as root and the entrypoint
fixes the ownership).

## Notes

- **One instance.** A disk attaches to one instance; SQLite has one writer.
- **Deploys** have a short downtime with a disk attached (Render stops the old instance before
  starting the new one). Clients keep working offline meanwhile.
- **Backups.** Render snapshots disks daily. For copies elsewhere, run `tessera-server backup`
  in the Shell and download the file.
- **Upgrades.** Change the tag in `deploy/render/Dockerfile` and push, or trigger a deploy. See
  [UPGRADING.md](../UPGRADING.md).
