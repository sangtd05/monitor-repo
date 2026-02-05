# Modern Observability Stack (LGTM + Alloy)

[![CI](https://github.com/sangtd05/monitor-repo/actions/workflows/ci.yml/badge.svg)](https://github.com/sangtd05/monitor-repo/actions/workflows/ci.yml)

Hệ thống giám sát hiện đại dựa trên **LGTM Stack** (Loki, Grafana, Tempo, Mimir) với **Grafana Alloy** làm unified agent thu thập toàn bộ telemetry data. Được thiết kế để giám sát metrics, logs, traces và hiệu suất hạ tầng một cách tối ưu.

## Kiến trúc hệ thống

### Core Components

| Component | Chức năng | Port | Ghi chú |
|-----------|-----------|------|---------|
| **Grafana** | Visualization & Dashboarding | `3000` | Giao diện trực quan hóa + Unified Alerting |
| **Mimir** | Long-term Metrics Storage + Ruler | `9009` | Lưu trữ metrics & Đánh giá alert rules |
| **MinIO** | S3-compatible Object Storage | `9000`, `9001` | Object storage cho Mimir & Tempo |
| **Loki** | Log Aggregation | `3100` | Thu thập và lưu trữ logs |
| **Tempo** | Distributed Tracing | `3200` | Distributed tracing backend |
| **Pyroscope** | Continuous Profiling | `4040` | Profiling ứng dụng |
| **Alertmanager** | Alerting System | `9093` | Cảnh báo qua Telegram |
| **Grafana Alloy** | Unified Observability Agent | `4317`, `4318`, `12345` | **Thu thập TOÀN BỘ: Metrics, Logs, Traces** |
| **Blackbox Exporter** | Synthetic Monitoring | `9115` | Health checks cho services |
| **Node Exporter** | Host Metrics Exporter | `9100` | Metrics của monitoring server |

### Grafana Alloy - Unified Agent

**Grafana Alloy** là unified agent duy nhất thay thế **Promtail**, **OpenTelemetry Collector** VÀ **Prometheus scraping**, cung cấp:

#### Logs Collection (thay thế Promtail)
- **Docker Logs**: Tự động thu thập logs từ tất cả containers qua Docker socket
- **System Logs**: Thu thập logs từ `/var/log/*.log`
- **Exporter Logs**: Thu thập riêng logs của các exporters
- **Log Processing**: Lọc logs lỗi, logs cũ, và corrupted logs

#### Traces Collection (thay thế OTel Collector)
- **OTLP gRPC**: Port `4317` - nhận traces từ applications
- **OTLP HTTP**: Port `4318` - nhận traces qua HTTP
- **Memory Limiter**: Giới hạn 400MiB để tránh OOM
- **Batch Processing**: Tối ưu hiệu suất với batching

#### Metrics Collection (thay thế Prometheus scraping)
- **Scrape tất cả exporters**: Node, cAdvisor, Nginx, MongoDB, PostgreSQL, Blackbox
- **File-based Service Discovery**: Đọc targets từ `lgtm-stack/alloy/targets/*.json`
- **Remote Write to Mimir**: Gửi metrics trực tiếp vào Mimir
- **Filtering**: Loại bỏ OTLP internal metrics trước khi gửi

#### Self-Monitoring
- **Port `12345`**: Alloy metrics endpoint
- Tự động scrape và gửi metrics của chính nó về Mimir

### Mimir Ruler - Alert Evaluation

**Mimir Ruler** thay thế Prometheus trong việc đánh giá alert rules:

#### Alert Rule Evaluation
- **Rules Directory**: `lgtm-stack/mimir/rules/demo/` - chứa tất cả alert rules (YAML format)
- **Evaluation Interval**: 15s - tần suất đánh giá rules
- **Global View**: Đánh giá alerts dựa trên toàn bộ metrics trong Mimir (không giới hạn như Prometheus)
- **Alertmanager Integration**: Gửi alerts trực tiếp đến Alertmanager

### Data Retention

#### Tempo (Traces)
- **Retention Period**: 168h (7 ngày)
- **Configuration**: `overrides.block_retention` trong `tempo-config.yml`
- **Storage**: MinIO S3-compatible storage
- **Auto Cleanup**: Tempo tự động xóa trace blocks cũ hơn retention period

#### Mimir (Metrics)
- **TSDB Local**: 24h (dữ liệu mới trong ingester)
- **Compactor Blocks**: 30d (dữ liệu lâu dài trong S3)
- **Configuration**: `limits.compactor_blocks_retention_period` trong `mimir-config.yml`
- **Auto Compaction**: Mimir tự động compact và xóa blocks cũ

#### Loki (Logs)
- **Retention Period**: Cấu hình trong `loki-config.yml`
- **Storage**: Local filesystem hoặc S3

### Database Monitoring

#### MongoDB Exporters
- Giám sát MongoDB clusters
- Metrics: connections, operations, replication, storage

#### PostgreSQL Exporters  
- Giám sát PostgreSQL databases
- Metrics: connections, queries, locks, replication

## Getting Started

### 1. Cấu hình môi trường

#### Environment Variables (`.env`)

Tạo file `.env` trong thư mục `lgtm-stack/`:

```bash
cd lgtm-stack
cp .env.example .env
```

Chỉnh sửa file `.env`:

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

Để thêm/xóa servers cần giám sát, chỉnh sửa các file JSON trong `lgtm-stack/alloy/targets/`:

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

> **Lưu ý**: Alloy tự động reload cấu hình khi các file JSON thay đổi (File-based Service Discovery).

#### Alert Rules

Alert rules được lưu trong `lgtm-stack/mimir/rules/demo/*.yml` theo format Prometheus:

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

> **Lưu ý**: Mimir Ruler tự động load rules từ `/data/mimir/rules/`. Không cần reload manually.