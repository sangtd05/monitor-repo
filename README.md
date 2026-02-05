# Modern Observability Stack (LGTM + Alloy)

[![CI](https://github.com/sangtd05/monitor-repo/actions/workflows/ci.yml/badge.svg)](https://github.com/sangtd05/monitor-repo/actions/workflows/ci.yml)

A modern monitoring system based on **LGTM Stack** (Loki, Grafana, Tempo, Mimir) with **Grafana Alloy** as the unified agent for collecting all telemetry data. Designed to optimally monitor metrics, logs, traces, and infrastructure performance.

## System Architecture

### Core Components

| Component | Function | Port | Notes |
|-----------|----------|------|-------|
| **Grafana** | Visualization & Dashboarding | `3000` | Visualization interface + Unified Alerting |
| **Mimir** | Long-term Metrics Storage + Ruler | `9009` | Metrics storage & Alert rule evaluation |
| **MinIO** | S3-compatible Object Storage | `9000`, `9001` | Object storage for Mimir & Tempo |
| **Loki** | Log Aggregation | `3100` | Log collection and storage |
| **Tempo** | Distributed Tracing | `3200` | Distributed tracing backend |
| **Pyroscope** | Continuous Profiling | `4040` | Application profiling |
| **Alertmanager** | Alerting System | `9093` | Telegram notifications |
| **Grafana Alloy** | Unified Observability Agent | `4317`, `4318`, `12345` | **Collects ALL: Metrics, Logs, Traces** |
| **Blackbox Exporter** | Synthetic Monitoring | `9115` | Service health checks |
| **Node Exporter** | Host Metrics Exporter | `9100` | Monitoring server metrics |

### Grafana Alloy - Unified Agent

**Grafana Alloy** is the single unified agent replacing **Promtail**, **OpenTelemetry Collector** AND **Prometheus scraping**, providing:

#### Logs Collection (replaces Promtail)
- **Docker Logs**: Automatically collects logs from all containers via Docker socket
- **System Logs**: Collects logs from `/var/log/*.log`
- **Exporter Logs**: Separately collects exporter logs
- **Log Processing**: Filters error logs, old logs, and corrupted logs

#### Traces Collection (replaces OTel Collector)
- **OTLP gRPC**: Port `4317` - receives traces from applications
- **OTLP HTTP**: Port `4318` - receives traces via HTTP
- **Memory Limiter**: 400MiB limit to prevent OOM
- **Batch Processing**: Optimizes performance with batching

#### Metrics Collection (replaces Prometheus scraping)
- **Scrapes all exporters**: Node, cAdvisor, Nginx, MongoDB, PostgreSQL, Blackbox
- **File-based Service Discovery**: Reads targets from `lgtm-stack/alloy/targets/*.json`
- **Remote Write to Mimir**: Sends metrics directly to Mimir
- **Filtering**: Removes OTLP internal metrics before sending

#### Self-Monitoring
- **Port `12345`**: Alloy metrics endpoint
- Automatically scrapes and sends its own metrics to Mimir

### Mimir Ruler - Alert Evaluation

**Mimir Ruler** replaces Prometheus for alert rule evaluation:

#### Alert Rule Evaluation
- **Rules Directory**: `lgtm-stack/mimir/rules/demo/` - contains all alert rules (YAML format)
- **Evaluation Interval**: 15s - rule evaluation frequency
- **Global View**: Evaluates alerts based on all metrics in Mimir (no limits like Prometheus)
- **Alertmanager Integration**: Sends alerts directly to Alertmanager

### Data Retention

#### Tempo (Traces)
- **Retention Period**: 168h (7 days)
- **Configuration**: `overrides.block_retention` in `tempo-config.yml`
- **Storage**: MinIO S3-compatible storage
- **Auto Cleanup**: Tempo automatically deletes trace blocks older than retention period

#### Mimir (Metrics)
- **TSDB Local**: 24h (recent data in ingester)
- **Compactor Blocks**: 30d (long-term data in S3)
- **Configuration**: `limits.compactor_blocks_retention_period` in `mimir-config.yml`
- **Auto Compaction**: Mimir automatically compacts and deletes old blocks

#### Loki (Logs)
- **Retention Period**: Configured in `loki-config.yml`
- **Storage**: Local filesystem or S3

### Database Monitoring

#### MongoDB Exporters
- Monitors MongoDB clusters
- Metrics: connections, operations, replication, storage

#### PostgreSQL Exporters  
- Monitors PostgreSQL databases
- Metrics: connections, queries, locks, replication

## Getting Started

### 1. Environment Configuration

#### Environment Variables (`.env`)

Create `.env` file in `lgtm-stack/` directory:

```bash
cd lgtm-stack
cp .env.example .env
```

Edit the `.env` file:

```env
# Grafana Admin Password
GRAFANA_PASSWORD=your_secure_password

# Alertmanager Configuration
ALERTMANAGER_URL=http://localhost:9093
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id

# MinIO Credentials (for Mimir & Tempo storage)
MINIO_ROOT_USER=mimir
MINIO_ROOT_PASSWORD=mimir123
```

#### Monitoring Targets (JSON)

To add/remove servers to monitor, edit JSON files in `lgtm-stack/alloy/targets/`:

**Node Exporter** (`alloy/targets/node.json`):
```json
[
  {
    "targets": ["192.168.1.10:9100", "192.168.1.11:9100"],
    "labels": {
      "environment": "production",
      "role": "web-server"
    }
  }
]
```

**Nginx** (`alloy/targets/nginx.json`):
```json
[
  {
    "targets": ["192.168.1.10:9113"],
    "labels": {
      "environment": "production"
    }
  }
]
```

**cAdvisor** (`alloy/targets/cadvisor.json`):
```json
[
  {
    "targets": ["192.168.1.10:8080"],
    "labels": {
      "environment": "production"
    }
  }
]
```

**MongoDB** (`alloy/targets/mongodb.json`):
```json
[
  {
    "targets": ["mongodb-exporter-ptit:9216"],
    "labels": {
      "cluster": "ptit",
      "environment": "production"
    }
  }
]
```

**PostgreSQL** (`alloy/targets/postgres.json`):
```json
[
  {
    "targets": ["postgres-exporter-ptit:9187"],
    "labels": {
      "cluster": "ptit",
      "environment": "production"
    }
  }
]
```

**Blackbox Health Checks** (`alloy/targets/blackbox-liveness.json`, `alloy/targets/blackbox-readiness.json`):
```json
[
  {
    "targets": [
      "http://10.170.100.27:8000/app/timestamp",
      "http://backend-service:8080/health"
    ],
    "labels": {
      "env": "production",
      "probe_type": "liveness"
    }
  }
]
```

> **Note**: Alloy automatically reloads configuration when JSON files change (File-based Service Discovery).

#### Alert Rules

Alert rules are stored in `lgtm-stack/mimir/rules/demo/*.yml` in Prometheus format:

```yaml
groups:
  - name: node_exporter
    interval: 30s
    rules:
      - alert: NodeDown
        expr: up{job="node_exporter"} == 0
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Node {{ $labels.instance }} is down"
```

> **Note**: Mimir Ruler automatically loads rules from `/data/mimir/rules/`. No manual reload needed.