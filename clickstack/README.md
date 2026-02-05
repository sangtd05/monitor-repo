# ClickStack Monitoring

Modern observability stack using ClickHouse and HyperDX.

## Architecture

- **ClickStack** - ClickHouse database + HyperDX UI/API
- **Grafana** - Dashboards & visualization (ClickHouse datasource)
- **OTel Collector** - Metrics & logs collection
- **Socat** - Docker socket proxy
- **Node Exporter** - System metrics
- **Blackbox Exporter** - HTTP/TCP probes

## Quick Start

```bash
# Set your server IP in .env
nano .env

# Start stack
docker compose up -d

# Check logs
docker logs -f clickstack
docker logs -f otel-collector

# Access HyperDX UI
http://YOUR_SERVER_IP:8080
```

## Configuration

### Prometheus Targets

Edit target files in `otel-collector/targets/`:
- `node.json` - Node Exporter targets
- `mongodb.json` - MongoDB Exporter targets
- `postgres.json` - PostgreSQL Exporter targets
- `nginx.json` - Nginx Exporter targets
- `cadvisor.json` - cAdvisor targets
- `blackbox-liveness.json` - HTTP liveness probes
- `blackbox-readiness.json` - HTTP readiness probes

### Blackbox Probes

Edit `blackbox/blackbox.yml` for HTTP/TCP/ICMP probe configurations.

## Ports

- `3000` - Grafana UI
- `8080` - HyperDX UI
- `8000` - HyperDX API
- `4317` - OTLP gRPC
- `4318` - OTLP HTTP
- `8123` - ClickHouse HTTP
- `9000` - ClickHouse Native
- `9115` - Blackbox Exporter
- `13133` - OTel Collector health check

## Data Collection

### Metrics
- Docker container stats
- Prometheus targets (Node, MongoDB, PostgreSQL, Nginx, cAdvisor)
- Blackbox HTTP probes

### Logs
- Docker container logs (auto-collected)
- Filtered: corrupted logs, loki/alloy logs, logs >24h

### Traces
- OTLP endpoint: `http://YOUR_SERVER_IP:4318`
