# System Monitor (LGTM Stack)

This project provides a comprehensive monitoring solution based on the **LGTM Stack** (Loki, Grafana, Tempo, Prometheus) combined with OpenTelemetry. It is designed to monitor system metrics, application traces, logs, and database performance (MongoDB, PostgreSQL).

## Architecture

The system consists of the following core components:

| Component | Function | Port |
|-----------|----------|------|
| **Grafana** | Visualization & Dashboarding | `3000` |
| **Prometheus** | Metrics Collection & Storage | `9090` |
| **Loki** | Log Aggregation | `3100` |
| **Tempo** | Distributed Tracing | `3200` |
| **Alertmanager** | Alerting (Telegram integrated) | `9093` |
| **Otel Collector**| OpenTelemetry Receiver (Traces/Metrics)| `4317` (gRPC), `4318` (HTTP) |
| **Promtail** | Log Shipper (Docker & System logs) | N/A |

### Database Exporters
- **MongoDB Exporters**: Monitor MongoDB clusters.
- **Postgres Exporters**: Monitor PostgreSQL databases.

## Getting Started

### 1. Configuration (Dynamic)

This project has been refactored to use **Environment Variables** and **External Files** for all sensitive or changeable configurations. You do **not** need to modify the core `docker-compose.yml` or `prometheus.yml` for standard operations.

#### Environment Variables (`.env`)
The project now uses a **single unified `.env` file** at the project root (`d:\devops\monitor\.env`).
All services (Grafana, Exporters, Alertmanager) read from this file.

**`d:\devops\monitor\.env`**:
```env
# Database Connection Strings
MONGODB_URI_VWA=...
MONGODB_URI_PTIT=...
POSTGRES_DSN_VWA=...
POSTGRES_DSN_PTIT=...

# Grafana & Alerts
GRAFANA_PASSWORD=admin
ALERTMANAGER_URL=http://localhost:9093
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

#### Monitoring Targets (JSON)
To add or remove monitored servers, edit the JSON files in `grafana-prometheus/prometheus/`:
- **Node Exporter**: `targets.json`
- **Nginx**: `nginx_targets.json`
- **Cadvisor**: `cadvisor_targets.json`

*Changes to these files are picked up automatically by Prometheus (File-based Service Discovery).*

### 2. Running the Stack

Navigate to the main directory and start the services:

```bash
cd grafana-prometheus
docker-compose up -d
```

To view the logs:
```bash
docker-compose logs -f
```

## Data Flow

1.  **Metrics**: Scraped by Prometheus from exporters defined in `*.json` files or static targets in `docker-compose`.
2.  **Logs**:
    - **Docker Containers**: Automatically collected by Promtail via socket.
    - **Apps**: Can push directly to Loki.
3.  **Traces**: Applications push traces to **Otel Collector** or **Tempo** on ports `4317`/`4318`.

## 📚 Documentation

### 🚀 Getting Started
- **[SOLUTION_ANALYSIS.md](./docs/SOLUTION_ANALYSIS.md)** - Problem analysis, solution comparison, and deployment roadmap
- **[DEPLOYMENT.md](./docs/DEPLOYMENT.md)** - Complete deployment guide for production environments
- **[NETWORK_ARCHITECTURE.md](./docs/NETWORK_ARCHITECTURE.md)** - Network topology, data flows, and HA architecture

### 📖 Deep Dive
- **[OVERVIEW.md](./docs/OVERVIEW.md)** - System overview and observability concepts
- **[METRICS.md](./docs/METRICS.md)** - Prometheus, exporters, and PromQL queries
- **[LOGS.md](./docs/LOGS.md)** - Loki, Promtail, and log aggregation
- **[TRACES.md](./docs/TRACES.md)** - OpenTelemetry and distributed tracing
- **[DATABASE-MONITORING.md](./docs/DATABASE-MONITORING.md)** - MongoDB and PostgreSQL monitoring
- **[APPLICATION-LOGGING.md](./docs/APPLICATION-LOGGING.md)** - NestJS Pino-Loki integration

### 🔧 Operations
- **[INCIDENT_RESPONSE.md](./docs/INCIDENT_RESPONSE.md)** - Incident workflows, runbooks, and troubleshooting
- **[SRE_BEST_PRACTICES.md](./docs/SRE_BEST_PRACTICES.md)** - SRE principles and best practices

