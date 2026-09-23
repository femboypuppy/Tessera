# Tessera for Render: the published image, started as root because Render mounts disks owned by
# root. The image's entrypoint hands /data to the `node` user once and runs the server as `node`.
# Pin a release instead of latest; UPGRADING.md explains upgrades.
FROM ghcr.io/femboypuppy/tessera:latest
USER root
