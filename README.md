# System Monitor (LGTM Stack)

Hệ thống giám sát toàn diện dựa trên **LGTM Stack** (Loki, Grafana, Tempo, Mimir) kết hợp với **Grafana Alloy**. Được thiết kế để giám sát metrics hệ thống, application traces, logs, và hiệu suất database (MongoDB, PostgreSQL).

## Kiến trúc hệ thống

### Core Components

| Component | Chức năng | Port | Ghi chú |
|-----------|-----------|------|---------|
| **Grafana** | Visualization & Dashboarding | `3000` | Giao diện trực quan hóa dữ liệu |
| **Prometheus** | Metrics Collection & Storage | `9090` | Thu thập metrics ngắn hạn |
| **Mimir** | Long-term Metrics Storage | `9009` | Lưu trữ metrics dài hạn |
| **MinIO** | S3-compatible Object Storage | `9000`, `9001` | Object storage cho Mimir & Tempo |
| **Loki** | Log Aggregation | `3100` | Thu thập và lưu trữ logs |
| **Tempo** | Distributed Tracing | `3200` | Distributed tracing backend |
| **Pyroscope** | Continuous Profiling | `4040` | Profiling ứng dụng |
| **Alertmanager** | Alerting System | `9093` | Cảnh báo qua Telegram |
| **Grafana Alloy** | Unified Observability Agent | `4317`, `4318`, `12345` | **Thay thế Promtail + OTel Collector** |
| **Blackbox Exporter** | Synthetic Monitoring | `9115` | Health checks cho services |
| **Node Exporter** | Host Metrics Exporter | `9100` | Metrics của monitoring server |

### Grafana Alloy - Unified Agent

**Grafana Alloy** là agent thống nhất thay thế cho **Promtail** và **OpenTelemetry Collector**, cung cấp:

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

#### Self-Monitoring
- **Port `12345`**: Alloy metrics endpoint
- Tự động gửi metrics của chính nó về Prometheus

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
# Database Connection Strings
MONGODB_URI_PTIT=mongodb://user:password@host:27017/admin
POSTGRES_DSN_PTIT=postgresql://user:password@host:5432/dbname?sslmode=disable

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

Để thêm/xóa servers cần giám sát, chỉnh sửa các file JSON trong `grafana-prometheus/prometheus/targets/`:

**Node Exporter** (`targets/node.json`):
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

> **Lưu ý**: Prometheus tự động reload cấu hình khi các file JSON thay đổi (File-based Service Discovery).

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
| Prometheus | http://localhost:9090 | - |
| Alertmanager | http://localhost:9093 | - |
| MinIO Console | http://localhost:9001 | mimir / mimir123 |
| Alloy UI | http://localhost:12345 | - |

## Data Flow

### 1. Metrics Flow
```
Exporters (Node/Nginx/DB) 
  → Prometheus (scrape every 15s)
  → Mimir (long-term storage via remote_write)
  → Grafana (visualization)
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
docker-compose logs -f prometheus
docker-compose logs -f loki
```

### Restart một service
```bash
docker-compose restart alloy
docker-compose restart prometheus
```

### Reload Prometheus configuration
```bash
curl -X POST http://localhost:9090/-/reload
```

### Kiểm tra Alloy configuration
```bash
docker exec alloy alloy fmt /etc/alloy/config.alloy
```

### Backup dữ liệu
```bash
# Backup Grafana dashboards
docker exec grafana grafana-cli admin export-dashboard

# Backup Prometheus data
docker run --rm -v prometheus-data:/data -v $(pwd):/backup alpine tar czf /backup/prometheus-backup.tar.gz /data
```

## Alert Rules

Hệ thống có sẵn các alert rules cho:

- **Node Exporter**: CPU, Memory, Disk, Network
- **Docker**: Container down, high resource usage
- **MongoDB**: Replication lag, connections, operations
- **PostgreSQL**: Connections, locks, replication
- **Nginx**: High error rate, response time
- **LGTM Stack**: Service down, high resource usage
- **Tempo**: Service latency, error rates, traffic anomalies
- **Blackbox**: Health check failures, slow responses, flapping

Xem chi tiết tại: `grafana-prometheus/prometheus/alerts/*.yml`

### Cấu trúc Prometheus

```
prometheus/
├── targets/           # Service discovery files
│   ├── node.json
│   ├── cadvisor.json
│   ├── nginx.json
│   ├── mongodb.json
│   ├── postgres.json
│   ├── blackbox-liveness.json
│   └── blackbox-readiness.json
├── alerts/            # Alert rules
│   ├── node-exporter.yml
│   ├── docker.yml
│   ├── lgtm-stack.yml
│   ├── mongodb.yml
│   ├── nginx.yml
│   ├── postgresql.yml
│   ├── tempo.yml
│   └── blackbox.yml
└── prometheus.yml     # Main config
```

## 🔍 Troubleshooting

### Alloy không thu thập được logs
```bash
# Kiểm tra Alloy có quyền truy cập Docker socket
docker exec alloy ls -la /var/run/docker.sock

# Xem Alloy logs
docker-compose logs -f alloy
```

### Prometheus không scrape được targets
```bash
# Kiểm tra targets status
curl http://localhost:9090/api/v1/targets

# Kiểm tra file JSON targets
cat grafana-prometheus/prometheus/targets/node.json
```

### Mimir không nhận được metrics
```bash
# Kiểm tra remote write status
curl http://localhost:9090/api/v1/status/tsdb

# Kiểm tra Mimir logs
docker-compose logs -f mimir
```