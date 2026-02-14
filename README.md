# Modern Observability Stack (LGTM + Alloy)

[![Validate](https://github.com/sangtd05/monitor-repo/actions/workflows/validate.yml/badge.svg)](https://github.com/sangtd05/monitor-repo/actions/workflows/validate.yml)

A modern monitoring system based on **LGTM Stack** (Loki, Grafana, Tempo, Mimir) with **Grafana Alloy** as the unified agent for collecting all telemetry data. Designed to optimally monitor metrics, logs, traces, and infrastructure performance.

## System Architecture

### Core Components

| Component | Function | Port | Notes |
|-----------|----------|------|-------|
| **Grafana** | Visualization & Dashboarding | `3000` | Visualization interface + Unified Alerting |
| **Mimir** | Long-term Metrics Storage + Ruler | `9009` | Metrics storage & Alert rule evaluation |
| **SeaweedFS** | S3-compatible Object Storage | `9000`, `9333`, `8080` | Distributed object storage for Mimir, Loki & Tempo |
| **Loki** | Log Aggregation | `3100` | Log collection and storage |
| **Tempo** | Distributed Tracing | `3200` | Distributed tracing backend with OTLP support |
| **Alertmanager** | Alerting System | `9093` | Telegram notifications |
| **Grafana Alloy** | Unified Observability Agent | `4317`, `4318`, `12345` | **Collects ALL: Metrics, Logs, Traces** |
| **Blackbox Exporter** | Synthetic Monitoring | `9115` | Service health checks |
| **Node Exporter** | Host Metrics Exporter | `9100` | Monitoring server metrics |

### Grafana Alloy - Unified Agent

**Grafana Alloy** is the single unified agent replacing **Promtail**, **OpenTelemetry Collector** AND **Prometheus scraping**, providing:

#### Logs Collection (replaces Promtail)
- **Docker Logs**: Automatically collects logs from all containers via Docker socket
- **System Logs**: Collects logs from `/var/log/*.log`
- **Log Processing**: Filters, parses and enriches logs before sending to Loki

#### Traces Collection (replaces OTel Collector)
- **OTLP gRPC**: Port `4317` - receives traces from applications
- **OTLP HTTP**: Port `4318` - receives traces via HTTP
- **Automatic forwarding**: Sends traces directly to Tempo

#### Metrics Collection (replaces Prometheus scraping)
- **Scrapes all exporters**: Node Exporter, Blackbox Exporter
- **File-based Service Discovery**: Reads targets from `lgtm-stack/alloy/targets/*.json`
- **Remote Write to Mimir**: Sends metrics directly to Mimir with `X-Scope-OrgID: demo` header

#### Self-Monitoring
- **Port `12345`**: Alloy admin interface and metrics endpoint
- Automatically scrapes and sends its own metrics to Mimir

### SeaweedFS - Object Storage

**SeaweedFS** provides S3-compatible object storage for all LGTM components:

#### Key Features
- **S3 API Compatible**: Drop-in replacement for MinIO/AWS S3
- **Lightweight**: Single binary, easy deployment
- **Auto-initialization**: Buckets are created automatically on first startup
- **Credentials**: Access Key `mimir` / Secret Key `mimir123` (configured in `seaweedfs/s3.json`)

#### Buckets Used
- `mimir-blocks`: Mimir long-term metric blocks
- `mimir-ruler`: Mimir ruler storage
- `mimir-alertmanager`: Alertmanager state 
- `tempo`: Tempo trace blocks
- `loki`: Loki log chunks and indexes

#### Ports
- `9000`: S3 API endpoint
- `9333`: Master server (cluster status)
- `8080`: Filer (file system interface)

### Mimir Ruler - Alert Evaluation

**Mimir Ruler** replaces Prometheus for alert rule evaluation:

#### Alert Rule Evaluation
- **Rules Directory**: `lgtm-stack/mimir/rules/demo/` - contains all alert rules (YAML format)
- **Evaluation Interval**: 15s - rule evaluation frequency
- **Global View**: Evaluates alerts based on all metrics in Mimir (no shard limits)
- **Alertmanager Integration**: Sends alerts directly to Alertmanager

#### Available Alert Rules
- `blackbox.yml`: Health check alerts (HTTP/TCP probe failures)
- `docker.yml`: Container alerts (restarts, high memory/CPU)
- `lgtm-stack.yml`: LGTM stack component health
- `node-exporter.yml`: Host system alerts (disk, memory, CPU)
- `nginx.yml`: Nginx web server alerts
- `mongodb.yml`: MongoDB database alerts
- `postgresql.yml`: PostgreSQL database alerts
- `tempo.yml`: Tempo tracing backend alerts

### Data Retention

#### Tempo (Traces)
- **Retention Period**: 168h (7 days)
- **Configuration**: `overrides.block_retention` in `tempo-config.yml`
- **Storage Backend**: SeaweedFS S3 bucket `tempo`
- **Auto Cleanup**: Tempo automatically deletes trace blocks older than retention period
- **Local WAL**: Recent traces stored in `/var/tempo/wal` before flushing to S3

#### Mimir (Metrics)
- **Ingester TSDB**: 24h (recent data in memory/local disk)
- **Long-term Storage**: 30d (compacted blocks in SeaweedFS S3)
- **Configuration**: `limits.compactor_blocks_retention_period` in `mimir-config.yml`
- **Buckets**: Uses `mimir-blocks`, `mimir-ruler`, `mimir-alertmanager` in SeaweedFS
- **Auto Compaction**: Mimir compactor automatically compacts and deletes old blocks

#### Loki (Logs)
- **Storage Backend**: SeaweedFS S3 bucket `loki`
- **Retention Period**: Configurable in `loki-config.yml`
- **Local WAL**: Recent logs in `/loki` before flushing to S3