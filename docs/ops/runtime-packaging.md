# Runtime Packaging (OPS-03)

This repository includes packaging templates for container and systemd deployments.

## Docker Compose

Files:

- `deploy/Dockerfile`
- `deploy/docker-compose.yml`

Commands:

```bash
cd "deploy"
docker compose up -d --build
docker compose ps
docker compose restart "homunculus"
docker compose down
```

Restart policy:

- Compose service uses `restart: unless-stopped`.

Health check:

- Container health command runs:
  - `python -m homunculus --check --config /app/config/homunculus.example.json`

## systemd

Template:

- `deploy/systemd/homunculus.service`

Example install:

```bash
sudo cp "deploy/systemd/homunculus.service" "/etc/systemd/system/homunculus.service"
sudo systemctl daemon-reload
sudo systemctl enable --now "homunculus.service"
```

Service commands:

```bash
sudo systemctl status "homunculus.service"
sudo systemctl restart "homunculus.service"
sudo systemctl stop "homunculus.service"
```

Restart policy:

- systemd unit uses `Restart=always` with `RestartSec=5`.

Health check:

- `ExecStartPre` validates runtime config with `python -m homunculus --check`.
