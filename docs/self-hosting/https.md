# HTTPS and reverse proxies

Anyone signing in over the internet should reach Tessera through HTTPS. Two things matter for any
setup:

1. **WebSockets** must be forwarded. Sync runs over a WebSocket on the same address as the app.
2. **`PUBLIC_URL`** must be the `https://` address people use (see the
   [configuration reference](./configuration#public_url)).

## Caddy (the easiest)

Caddy gets and renews Let's Encrypt certificates on its own and forwards WebSockets without extra
configuration.

**With the bundled compose service.** `docker-compose.yml` includes an optional Caddy service. Set
your domain in `.env`, point the domain's DNS at the server, open ports 80 and 443, and enable the
service as the comments in the compose file describe.

**With your own Caddy**, add a site to your `Caddyfile`:

```txt
notes.example.com {
	reverse_proxy localhost:8787
}
```

## nginx

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name notes.example.com;

    ssl_certificate     /etc/letsencrypt/live/notes.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/notes.example.com/privkey.pem;

    # Match MAX_UPLOAD_MB (plus a little headroom).
    client_max_body_size 60m;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Sync connections stay open; don't cut them after 60 seconds.
        proxy_read_timeout 1h;
    }
}
```

## Traefik

With Docker labels on the Tessera service (Traefik forwards WebSockets automatically):

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.tessera.rule=Host(`notes.example.com`)
  - traefik.http.routers.tessera.entrypoints=websecure
  - traefik.http.routers.tessera.tls.certresolver=letsencrypt
  - traefik.http.services.tessera.loadbalancer.server.port=8787
```

## Private networks

On a home network or a VPN such as Tailscale or WireGuard, you can skip the public domain. Still
use HTTPS: browsers treat plain `http://` addresses other than `localhost` as insecure and turn
off features the web app relies on, such as the clipboard API. Tailscale can issue certificates
for your tailnet names.

## Check it

- `https://notes.example.com/api/health` returns `{"ok":true,…}`.
- In the app the sync indicator turns **Synced** within a second or two. If it stays on
  **Connecting**, the proxy isn't forwarding WebSockets.
