# Modern Observability Stack (LGTM + Alloy)

Hệ thống giám sát hiện đại dựa trên **LGTM Stack** (Loki, Grafana, Tempo, Mimir) với **Grafana Alloy** làm unified agent thu thập toàn bộ telemetry data. Được thiết kế để giám sát metrics, logs, traces và hiệu suất hạ tầng một cách tối ưu.

## Kiến trúc hệ thống

### Core Components

| Component | Chức năng | Port | Ghi chú |
|-----------|-----------|------|---------|
| **Grafana** | Visualization & Dashboarding | `3000` | Giao diện trực quan hóa + Unified Alerting |
| **Mimir** | Long-term Metrics Storage + Ruler | `9009` | Lưu trữ metrics & Đánh giá alert rules |
| **Mimir** | Long-term Metrics Storage | `9009` | Lưu trữ metrics dài hạn |
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
- **File-based Service Discovery**: Đọc targets từ `alloy/targets/*.json`
- **Remote Write to Mimir**: Gửi metrics trực tiếp vào Mimir
- **Filtering**: Loại bỏ OTLP internal metrics trước khi gửi

#### Self-Monitoring
- **Port `12345`**: Alloy metrics endpoint
- Tự động scrape và gửi metrics của chính nó về Mimir

### Mimir Ruler - Alert Evaluation

**Mimir Ruler** thay thế Prometheus trong việc đánh giá alert rules:

#### Alert Rule Evaluation
- **Rules Directory**: `/data/mimir/rules/` - chứa tất cả alert rules (YAML format)
- **Evaluation Interval**: 15s - tần suất đánh giá rules
- **Global View**: Đánh giá alerts dựa trên toàn bộ metrics trong Mimir (không giới hạn như Prometheus)
- **Alertmanager Integration**: Gửi alerts trực tiếp đến Alertmanager

#### Ưu điểm so với Prometheus
- **Scale tốt hơn**: Phân tán, high availability
- **Multi-tenancy**: Hỗ trợ nhiều tenants
- **Consistent with storage**: Rules chạy trên cùng data storage với queries

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

Tạo file `.env` trong thư mục `grafana-prometheus/`:

```bash
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

Để thêm/xóa servers cần giám sát, chỉnh sửa các file JSON trong `alloy/targets/`:

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

**Nginx** (`targets/nginx.json`):
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

**cAdvisor** (`targets/cadvisor.json`):
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

**MongoDB** (`targets/mongodb.json`):
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

**PostgreSQL** (`targets/postgres.json`):
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

**Blackbox Health Checks** (`targets/blackbox-liveness.json`, `targets/blackbox-readiness.json`):
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

Alert rules được lưu trong `mimir/rules/*.yml` theo format Prometheus:

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

### 2. Khởi động Stack

```bash
cd grafana-prometheus
docker-compose up -d
```

Kiểm tra logs:
```bash
docker-compose logs -f
```

Kiểm tra trạng thái:
```bash
docker-compose ps
```

### 3. Truy cập Services

| Service | URL | Credentials |
|---------|-----|-------------|
| Grafana | http://localhost:3000 | admin / `${GRAFANA_PASSWORD}` |
| Mimir | http://localhost:9009/prometheus | - |
| Alertmanager | http://localhost:9093 | - |
| MinIO Console | http://localhost:9001 | mimir / mimir123 |
| Alloy UI | http://localhost:12345 | - |

## Data Flow

### 1. Metrics Flow
```
Exporters (Node/Nginx/DB/Blackbox) 
  → Grafana Alloy (scrape every 15s)
  → Mimir (remote_write for long-term storage)
  → Grafana (visualization)

Alert Rules:
  Mimir Ruler (evaluate rules from /data/mimir/rules/)
  → Alertmanager (routing & grouping)
  → Telegram (notifications)
```

### 2. Logs Flow
```
Docker Containers / System Logs
  → Grafana Alloy (collection & processing)
  → Loki (storage & indexing)
  → Grafana (visualization & search)
```

### 3. Traces Flow
```
Applications (OTLP)
  → Grafana Alloy (port 4317/4318)
  → Tempo (storage in MinIO)
  → Grafana (visualization & analysis)
```

### 4. Alerts Flow
```
Prometheus (evaluate rules)
  → Alertmanager (routing & grouping)
  → Telegram (notifications)
```

## Quản lý và Bảo trì

### Xem logs của một service cụ thể
```bash
docker-compose logs -f alloy
docker-compose logs -f mimir
docker-compose logs -f loki
```

### Restart một service
```bash
docker-compose restart alloy
docker-compose restart mimir
```

### Check Mimir Ruler status
```bash
# List all alert rules
curl -s "http://localhost:9009/prometheus/api/v1/rules" | jq '.data.groups[].name'

# Check specific rule group
curl -s "http://localhost:9009/prometheus/api/v1/rules?type=alert" | jq
```

### Kiểm tra Alloy configuration
```bash
docker exec alloy alloy fmt /etc/alloy/config.alloy
```

### Backup dữ liệu
```bash
# Backup Grafana dashboards
docker exec grafana grafana-cli admin export-dashboard

### Backup alert rules
```bash
# Backup Mimir rules
tar czf mimir-rules-backup.tar.gz mimir/rules/
```

## Alert Rules

Hệ thống sử dụng **Mimir Ruler** để evaluate alert rules, có sẵn các rules cho:

- **Node Exporter**: CPU, Memory, Disk, Network
- **Docker**: Container down, high resource usage
- **MongoDB**: Replication lag, connections, operations
- **PostgreSQL**: Connections, locks, replication
- **Nginx**: High error rate, response time
- **LGTM Stack**: Service down, high resource usage
- **Tempo**: Service latency, error rates, traffic anomalies
- **Blackbox**: Health check failures, slow responses, flapping

Xem chi tiết tại: `mimir/rules/*.yml`

### Cấu trúc thư mục mới

```
grafana-prometheus/
├── alloy/
│   ├── config.alloy      # Alloy configuration (logs, traces, metrics)
│   └── targets/          # Service discovery files for metrics
│       ├── node.json
│       ├── cadvisor.json
│       ├── nginx.json
│       ├── mongodb.json
│       ├── postgres.json
│       ├── blackbox-liveness.json
│       └── blackbox-readiness.json
├── mimir/
│   ├── mimir-config.yml  # Mimir configuration (includes Ruler)
│   ├── runtime.yml       # Mimir runtime config
│   └── rules/            # Alert rules for Mimir Ruler
│       ├── node-exporter.yml
│       ├── docker.yml
│       ├── lgtm-stack.yml
│       ├── mongodb.yml
│       ├── nginx.yml
│       ├── postgresql.yml
│       ├── tempo.yml
│       └── blackbox.yml
├── grafana/
│   └── provisioning/     # Grafana datasources, dashboards, alerting
├── loki/
│   └── loki-config.yml
├── tempo/
│   └── tempo-config.yml
├── alertmanager/
│   └── alertmanager.yml.template
├── blackbox/
│   └── blackbox.yml
├── docker-compose.yml
└── .env
```

## 🔍 Troubleshooting

### Alloy không thu thập được metrics
```bash
# Check Alloy UI for scrape targets status
open http://localhost:12345

# Check if target files exist
ls -la alloy/targets/

# Xem Alloy logs
docker-compose logs -f alloy
```

### Mimir Ruler không load được rules
```bash
# Check Mimir logs
docker-compose logs -f mimir | grep -i ruler

# Verify rules directory is mounted
docker exec mimir ls -la /data/mimir/rules/

# Check rules API
curl http://localhost:9009/prometheus/api/v1/rules
```

### Mimir không nhận được metrics
```bash
# Query Mimir directly
curl -s "http://localhost:9009/prometheus/api/v1/query?query=up" | jq

# Check Mimir logs
docker-compose logs -f mimir
```