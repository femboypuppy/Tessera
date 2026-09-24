# Configuration reference

The server is configured with environment variables. It checks them all when it starts and stops
with a clear message if one is invalid, so a typo never runs silently.

With Docker Compose, put them in the `.env` file next to `docker-compose.yml`. With `docker run`,
pass each one with `-e NAME=value`.

## Summary

| Variable                          | Default                        | Example                     |
| ---------------------------------- | ------------------------------- | ---------------------------- |
| [`PORT`](#port)                   | `8787`                          | `8787`                       |
| [`HOST`](#host)                   | `0.0.0.0`                       | `127.0.0.1`                  |
| [`DATA_DIR`](#data_dir)           | `./data`; `/data` in the image  | `/var/lib/tessera`           |
| [`PUBLIC_URL`](#public_url)       | none                            | `https://notes.example.com`  |
| [`MAX_UPLOAD_MB`](#max_upload_mb) | `25`                            | `50`                         |
| [`SIGNUP_MODE`](#signup_mode)     | `invite`                        | `closed`                     |
| [`LOG_LEVEL`](#log_level)         | `info`                          | `debug`                      |
| [`CORS_ORIGINS`](#cors_origins)   | none                            | `http://localhost:5173`      |
| [`TRUST_PROXY`](#trust_proxy)     | `false`                         | `true`                       |
| [`WEB_DIR`](#web_dir)             | auto-detected                   | `/app/apps/web/dist`         |
| [`SESSION_DAYS`](#session_days)   | `30`                            | `14`                         |
| [`SETUP_CODE`](#setup_code)       | random, printed in the log      | `a-fixed-code-1234`          |

## `PORT`

The TCP port the server listens on, for both HTTP and WebSocket sync. In Docker, change the host
side of the port mapping (`-p 3000:8787`) rather than this.

## `HOST`

The network interface the server listens on. The default, `0.0.0.0`, listens on every interface;
use `127.0.0.1` to accept connections only from the same machine, for example behind a reverse
proxy on the same host.

## `DATA_DIR`

Where the server keeps everything: the SQLite database (documents, accounts, sessions, version
history) and uploaded attachments. It must be writable by the server's user.

In the Docker image it is set to `/data`; mount a volume there. Running the server outside Docker,
this is the only variable you must set:

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
session cookies, to enable HSTS, and as an allowed origin for the web and desktop apps. Set it
whenever the server is reachable at anything other than `http://localhost:<PORT>`.

## `MAX_UPLOAD_MB`

The largest attachment, in megabytes, that the server accepts (at most `2048`). Larger uploads are
refused with a clear error in the app. If you use a reverse proxy, raise its body-size limit to
match (see [HTTPS and reverse proxies](./https)).

## `SIGNUP_MODE`

Who may create an account.

| Value    | Meaning                                                               |
| -------- | ---------------------------------------------------------------------- |
| `invite` | Only people with an invite link can sign up. Recommended.              |
| `open`   | Anyone who can reach the server can sign up.                           |
| `closed` | Nobody can sign up. The owner can still create accounts from the CLI.  |

The owner account is created at first run (web form or `tessera-server create-owner`), whatever
the mode.

## `LOG_LEVEL`

How much the server logs: `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. Logs are
JSON lines on standard output (read them with `docker compose logs`). Use `debug` when reporting a
bug, and remove secrets before sharing logs.

## `CORS_ORIGINS`

Extra browser origins allowed to call the API with credentials and open cookie-authenticated
WebSockets, comma-separated (for example `http://localhost:5173` for the Vite dev server). The
server's own origin, `PUBLIC_URL` and the desktop app are always allowed; you rarely need this in
production.

## `TRUST_PROXY`

Set to `true` when the server sits behind a reverse proxy, so it trusts `X-Forwarded-For` (rate
limits, session IPs) and `X-Forwarded-Proto`. See [HTTPS and reverse proxies](./https).

## `WEB_DIR`

The built web app to serve. By default the server looks for `apps/web/dist` next to itself (the
Docker image sets this to `/app/apps/web/dist`); without a web build to serve, the server still
answers the API and sync.

## `SESSION_DAYS`

How many days a session lasts without being used (1 to 365; each use extends it).

## `SETUP_CODE`

Fixes the first-run setup code (at least 8 characters) instead of printing a random one in the
log. Useful for automated deployments that create the owner without reading the logs.

## Command-line tools

The image includes `tessera-server`, run with `docker exec`:

| Command                                | Does                                                                                                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `tessera-server create-owner`          | Creates the owner account: pass `--email` and `--name` (and `--password-stdin`), or answer the prompts.                                     |
| `tessera-server backup <file.tar.gz>`  | Writes a consistent backup of the database and attachments, while the server keeps running.                                                 |
| `tessera-server restore <file.tar.gz>` | Restores a backup into `DATA_DIR`. Stop the server first; the current data is moved to `DATA_DIR/pre-restore-<timestamp>/`, never deleted.   |

See [Backups and restore](./backups).
