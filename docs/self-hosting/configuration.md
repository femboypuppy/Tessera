# Configuration reference

The server is configured with environment variables. It checks them all when it starts and stops
with a clear message if one is invalid, so a typo never runs silently.

With Docker Compose, put them in the `.env` file next to `docker-compose.yml`. With `docker run`,
pass each one with `-e NAME=value`.

::: warning Pre-release
This page follows the server's configuration schema as designed for 0.1. Values marked
_to be confirmed_ are finalized with the first server release; `apps/server/README.md` in the
repository is always authoritative.
:::

## Summary

| Variable                            | Default                   | Example                          |
| ----------------------------------- | ------------------------- | -------------------------------- |
| [`PORT`](#port)                     | `8787`                    | `8787`                           |
| [`DATA_DIR`](#data_dir)             | `/data` in the image      | `/var/lib/tessera`               |
| [`PUBLIC_URL`](#public_url)         | none                      | `https://notes.example.com`      |
| [`SIGNUP_MODE`](#signup_mode)       | `invite` (to be confirmed) | `closed`                        |
| [`MAX_UPLOAD_MB`](#max_upload_mb)   | to be confirmed           | `50`                             |
| [`LOG_LEVEL`](#log_level)           | `info`                    | `debug`                          |

## `PORT`

The TCP port the server listens on, for both HTTP and WebSocket sync. In Docker, change the host
side of the port mapping (`-p 3000:8787`) rather than this.

## `DATA_DIR`

Where the server keeps everything: the SQLite database (documents, accounts, sessions, version
history) and uploaded attachments. It must be writable by the server's user.

In the Docker image it is `/data`; mount a volume there. Running the server outside Docker, this
is the only variable you must set:

```bash
DATA_DIR=./data pnpm --filter @tessera/server start
```

::: danger Don't share a data directory
Point exactly one server at a data directory, and don't put it in a file-sync folder (Dropbox,
iCloud, OneDrive). Use [backups](./backups) to copy it.
:::

## `PUBLIC_URL`

The address people use to reach the server, with the scheme and without a trailing slash, for
example `https://notes.example.com`. The server uses it to build invite links, to set secure
session cookies, and to accept connections from the web and desktop apps. Set it whenever the
server is reachable at anything other than `http://localhost:<PORT>`.

## `SIGNUP_MODE`

Who may create an account.

| Value    | Meaning                                                           |
| -------- | ----------------------------------------------------------------- |
| `invite` | Only people with an invite link can sign up. Recommended.         |
| `open`   | Anyone who can reach the server can sign up.                      |
| `closed` | Nobody can sign up. The owner can still create accounts from the CLI. |

The owner account is created at first run (web form or `tessera-server create-owner`), whatever
the mode.

## `MAX_UPLOAD_MB`

The largest attachment, in megabytes, that the server accepts. Larger uploads are refused with a
clear error in the app. If you use a reverse proxy, raise its body-size limit to match (see
[HTTPS and reverse proxies](./https)).

## `LOG_LEVEL`

How much the server logs: `fatal`, `error`, `warn`, `info`, `debug` or `trace`. Logs are JSON
lines on standard output (read them with `docker compose logs`). Use `debug` when reporting a bug,
and remove secrets before sharing logs.

## Command-line tools

The image includes `tessera-server`, run with `docker exec`:

| Command                            | Does                                                     |
| ---------------------------------- | -------------------------------------------------------- |
| `tessera-server create-owner`      | Creates the owner account interactively.                 |
| `tessera-server backup <file>`     | Writes a consistent backup of the database and attachments. |
| `tessera-server restore <file>`    | Restores a backup into an empty data directory.          |

See [Backups and restore](./backups).
