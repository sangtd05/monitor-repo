# LOGS - Hệ thống Thu thập và Phân tích Logs

## 🎯 Logs là gì và Tại sao cần Logs?

### Định nghĩa

**Logs** là các bản ghi (records) về các sự kiện (events) xảy ra trong hệ thống theo thời gian. Mỗi log entry thường chứa timestamp, level, message, và context.

```
2025-12-30 15:30:45 INFO  User login successful user_id=123 ip=10.0.0.1
2025-12-30 15:30:46 ERROR Database connection failed error="timeout after 5s"
2025-12-30 15:30:47 WARN  Cache miss key="user:123" fallback="database"
```

### So sánh với Metrics và Traces

| Aspect | Logs | Metrics | Traces |
|--------|------|---------|--------|
| **Dữ liệu** | Events rời rạc | Số đo theo thời gian | Request journey |
| **Cardinality** | Cao (mỗi event khác nhau) | Thấp (aggregated) | Trung bình |
| **Storage** | Nhiều | Ít | Trung bình |
| **Use case** | Debugging, audit | Monitoring, alerting | Performance analysis |
| **Câu hỏi** | "Chuyện gì đã xảy ra?" | "Hệ thống thế nào?" | "Request đi đâu?" |

### Tại sao Logs quan trọng?

#### 1. **Debugging và Troubleshooting**

**Scenario**: API trả về lỗi 500.

**Metrics chỉ cho biết:**
```promql
http_requests_total{status="500"} = 10
```
→ Biết có 10 requests lỗi, nhưng không biết tại sao.

**Logs cho biết:**
```
2025-12-30 15:30:45 ERROR [OrderController] Failed to create order
  user_id: 12345
  order_id: abc-123
  error: "Database connection timeout after 5s"
  stack_trace: |
    at OrderService.create (order.service.js:45)
    at OrderController.createOrder (order.controller.js:23)
  context: {
    "db_host": "postgres-primary",
    "connection_pool_size": 0,
    "waiting_connections": 50
  }
```
→ Biết chính xác: connection pool hết, database timeout.

#### 2. **Audit Trail**

Theo dõi ai làm gì, khi nào:
```
2025-12-30 15:30:45 AUDIT User admin@company.com deleted user user_id=999
2025-12-30 15:31:00 AUDIT User john@company.com updated permissions role=admin
2025-12-30 15:32:15 AUDIT Failed login attempt username=hacker ip=1.2.3.4
```

**Use cases:**
- Security investigations
- Compliance (GDPR, SOC2)
- Dispute resolution

#### 3. **Business Intelligence**

Phân tích hành vi người dùng:
```
2025-12-30 15:30:45 INFO User viewed product product_id=123 category=electronics
2025-12-30 15:30:50 INFO User added to cart product_id=123 quantity=1
2025-12-30 15:31:00 INFO User completed checkout order_id=abc-123 total=99.99
```

**Insights:**
- Conversion funnel
- Popular products
- User journey analysis

#### 4. **Error Tracking**

Tìm patterns trong errors:
```logql
{service="api"} |= "error" | json | line_format "{{.error_type}}"
```

**Kết quả:**
```
DatabaseTimeout: 45%
ValidationError: 30%
ExternalAPIError: 15%
UnknownError: 10%
```
→ Ưu tiên fix DatabaseTimeout trước.

## 🏗️ Kiến trúc Logging trong Hệ thống

```
┌────────────────────────────────────────────────────────────────┐
│                        LOG COLLECTION FLOW                      │
└────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                      Log Sources                             │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Docker     │  │  System      │  │  Database    │      │
│  │  Containers  │  │  Logs        │  │  Logs        │      │
│  │              │  │              │  │              │      │
│  │ • App logs   │  │ • /var/log   │  │ • PostgreSQL │      │
│  │ • stdout     │  │ • syslog     │  │ • MongoDB    │      │
│  │ • stderr     │  │ • auth.log   │  │              │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                 │                 │                │
│         │                 │                 │                │
└─────────┼─────────────────┼─────────────────┼────────────────┘
          │                 │                 │
          │                 │                 │
          └─────────────────┴─────────────────┘
                            │
                            ▼
                   ┌─────────────────┐
                   │    Promtail     │
                   │                 │
                   │ Jobs:           │
                   │ • docker        │
                   │ • system        │
                   │ • exporters     │
                   │                 │
                   │ Pipeline:       │
                   │ • Parse         │
                   │ • Label         │
                   │ • Filter        │
                   │ • Transform     │
                   └────────┬────────┘
                            │
                            │ HTTP Push
                            │ /loki/api/v1/push
                            ▼
                   ┌─────────────────┐
                   │      Loki       │
                   │                 │
                   │ • Ingest logs   │
                   │ • Index labels  │
                   │ • Store chunks  │
                   │ • Compress      │
                   │                 │
                   │ Storage:        │
                   │ • Filesystem    │
                   │ • Retention: 7d │
                   └────────┬────────┘
                            │
                            │ Query API
                            ▼
                   ┌─────────────────┐
                   │    Grafana      │
                   │                 │
                   │ • LogQL query   │
                   │ • Log browser   │
                   │ • Live tail     │
                   │ • Alerts        │
                   └─────────────────┘
```

## 🔧 Các Thành phần Chi tiết

### 1. Promtail - Log Collector

**Promtail** là agent thu thập logs và gửi đến Loki. Tương tự như Filebeat (ELK) hay Fluentd.

#### Tại sao Promtail?

**So với alternatives:**

| Feature | Promtail | Filebeat | Fluentd |
|---------|----------|----------|---------|
| **Designed for** | Loki | Elasticsearch | Multiple backends |
| **Config** | Simple YAML | Complex | Very flexible |
| **Resource** | Lightweight | Medium | Heavy |
| **Label-based** | ✅ Native | ❌ | ❌ |
| **Pipeline** | Built-in | Limited | Powerful |

**Ưu điểm Promtail:**
- Tích hợp hoàn hảo với Loki
- Label-based indexing (giống Prometheus)
- Pipeline stages mạnh mẽ
- Service discovery (Docker, Kubernetes)

#### Cấu hình Cơ bản

```yaml
server:
  http_listen_port: 9080
  grpc_listen_port: 0

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push
    tenant_id: "1"
```

**Giải thích:**

**1. Server:**
- HTTP port 9080: Metrics endpoint (`/metrics`)
- gRPC disabled (0): Không cần trong setup này

**2. Positions file:**
```yaml
# /tmp/positions.yaml
/var/log/app.log: 1024567
/var/log/error.log: 523890
```

**Mục đích:**
- Track vị trí đọc của mỗi file
- Tránh đọc lại logs cũ khi restart
- Resume từ vị trí cuối cùng

**3. Clients:**
- URL: Loki endpoint
- `tenant_id`: Multi-tenancy (optional, dùng "1" cho single tenant)

#### Scrape Configs - Thu thập Logs

### Job 1: Docker Containers

```yaml
- job_name: docker
  docker_sd_configs:
    - host: unix:///var/run/docker.sock
      refresh_interval: 5s
```

**Docker Service Discovery:**
- Tự động phát hiện containers
- Refresh mỗi 5s (containers mới/stopped)
- Lấy metadata từ Docker API

**Relabel Configs:**

```yaml
relabel_configs:
  # Tạo __path__ từ container ID
  - source_labels: ["__meta_docker_container_id"]
    target_label: "__path__"
    replacement: "/var/lib/docker/containers/$1/$1-json.log"
```

**Giải thích:**
- Docker lưu logs tại `/var/lib/docker/containers/<container_id>/<container_id>-json.log`
- `$1`: Capture group từ source_labels
- `__path__`: Special label cho Promtail biết đọc file nào

```yaml
  # Extract container name
  - source_labels: ["__meta_docker_container_name"]
    regex: "/(.*)"
    target_label: "container"
```

**Tại sao regex `"/(.*)"` ?**
- Docker container name có prefix `/`: `/my-app`
- Regex bỏ `/`, chỉ lấy `my-app`

```yaml
  # Extract service name từ docker-compose
  - source_labels: ["__meta_docker_container_label_com_docker_compose_service"]
    regex: "(.+)"
    target_label: "service"
    replacement: "$1"
```

**Docker Compose labels:**
```yaml
# docker-compose.yml
services:
  api:
    image: my-api
    labels:
      com.docker.compose.service: "api"
```
→ Promtail extract label này thành `service="api"`

**Fallback logic:**
```yaml
  # Nếu service rỗng, dùng container name
  - source_labels: ["service", "container"]
    regex: "^;(.+)$"
    target_label: "service"
    replacement: "$1"
  
  # Nếu vẫn rỗng, đặt "unknown_service"
  - source_labels: ["service_name"]
    regex: "^$"
    target_label: "service_name"
    replacement: "unknown_service"
```

**Pipeline Stages:**

```yaml
pipeline_stages:
  # Drop corrupted logs (null bytes)
  - drop:
      expression: ".*[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F].*"
      drop_counter_reason: "corrupted_log"
```

**Tại sao drop null bytes?**
- Docker đôi khi ghi corrupted data
- Null bytes (`\x00`) crash Loki parser
- Better drop than crash

```yaml
  # Parse Docker JSON format
  - docker: {}
```

**Docker log format:**
```json
{
  "log": "2025-12-30 15:30:45 INFO User login\n",
  "stream": "stdout",
  "time": "2025-12-30T08:30:45.123456789Z"
}
```

**Docker stage:**
- Extract `log` field → log line
- Extract `stream` → label `stream=stdout/stderr`
- Parse `time` → timestamp

```yaml
  # Drop old logs (> 24h)
  - drop:
      older_than: 24h
      drop_counter_reason: "log_too_old"
```

**Tại sao drop old logs?**
- Promtail restart có thể đọc lại old logs
- Loki reject logs quá cũ (configurable)
- Tránh spam Loki với stale data

### Job 2: System Logs

```yaml
- job_name: system
  static_configs:
    - targets:
        - localhost
      labels:
        job: varlogs
        service: varlogs
        service_name: varlogs
        __path__: /var/log/*.log
```

**Static config:**
- Không dùng service discovery
- Hardcode path: `/var/log/*.log`
- Glob pattern: match tất cả `.log` files

**Relabel để filter:**
```yaml
relabel_configs:
  - source_labels: [__path__]
    regex: '.*(apport|dpkg|ubuntu-advantage|vmware|alternatives|bootstrap|cloud-init).*\.log'
    action: drop
```

**Drop system logs không cần thiết:**
- `apport`: Crash reports
- `dpkg`: Package manager
- `cloud-init`: Cloud initialization
→ Noise, không cần monitor

**Pipeline để parse:**
```yaml
pipeline_stages:
  - regex:
      expression: '^(?P<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+(?P<level>\w+)\s+(?P<message>.*)'
  - labels:
      level:
  - timestamp:
      format: RFC3339
      source: timestamp
```

**Parse format:**
```
2025-12-30T15:30:45.123Z INFO User login successful
│                        │    │
│                        │    └─ message
│                        └─ level
└─ timestamp
```

### Job 3: Exporters

```yaml
- job_name: exporters
  docker_sd_configs:
    - host: unix:///var/run/docker.sock
      refresh_interval: 5s
  relabel_configs:
    # Chỉ giữ containers có "exporter" trong tên
    - source_labels: ["__meta_docker_container_name"]
      regex: ".*exporter.*"
      action: keep
```

**Tại sao riêng job cho exporters?**
- Exporters có log format khác
- Có thể cần pipeline riêng
- Dễ filter/debug

### 2. Loki - Log Aggregation System

**Loki** là log aggregation system của Grafana Labs, được thiết kế để "like Prometheus, but for logs".

#### Triết lý Thiết kế

**Prometheus approach:**
```
Metric: http_requests_total{method="GET", endpoint="/api/users", status="200"}
        │                   │
        │                   └─ Labels (indexed)
        └─ Metric name + value (not indexed)
```

**Loki approach:**
```
Log: "2025-12-30 15:30:45 GET /api/users 200 50ms"
     │                                              │
     │                                              └─ Log content (not indexed)
     └─ Labels: {job="api", level="info"} (indexed)
```

**Key difference:**
- **Prometheus**: Index everything (metric name + labels)
- **Loki**: Chỉ index labels, không index log content
- **ELK**: Index toàn bộ log content (full-text search)

**Trade-offs:**

| Feature | Loki | Elasticsearch |
|---------|------|---------------|
| **Index size** | Nhỏ (chỉ labels) | Lớn (full content) |
| **Storage cost** | Thấp | Cao |
| **Query speed** | Nhanh (label filtering) | Nhanh (full-text) |
| **Full-text search** | ❌ (grep-like) | ✅ (powerful) |
| **Setup complexity** | Đơn giản | Phức tạp |
| **Resource usage** | Thấp | Cao |

**Khi nào dùng Loki?**
- ✅ Label-based filtering đủ dùng
- ✅ Đã dùng Prometheus (consistent UX)
- ✅ Cost-sensitive
- ❌ Cần full-text search phức tạp
- ❌ Cần search trong log content

#### Cấu hình Loki

```yaml
auth_enabled: false
```
**Multi-tenancy:**
- `true`: Cần `X-Scope-OrgID` header
- `false`: Single tenant mode (đơn giản hơn)

```yaml
server:
  http_listen_port: 3100
  grpc_listen_port: 9096
  log_level: info
```

**Ports:**
- 3100: HTTP API (push logs, query)
- 9096: gRPC (internal communication)

```yaml
common:
  path_prefix: /loki
  storage:
    filesystem:
      chunks_directory: /loki/chunks
      rules_directory: /loki/rules
  replication_factor: 1
```

**Storage structure:**
```
/loki/
├── chunks/          ← Log data (compressed)
├── rules/           ← Alert rules
└── compactor/       ← Compaction working dir
```

**Replication factor:**
- `1`: Single instance (no replication)
- `3`: Production (HA setup)

#### Schema Config

```yaml
schema_config:
  configs:
    - from: 2024-01-01
      store: tsdb
      object_store: filesystem
      schema: v13
      index:
        prefix: index_
        period: 24h
```

**Giải thích:**

**1. Store: TSDB (Time Series Database)**
- Loki v2.8+ sử dụng TSDB index
- Tương tự Prometheus TSDB
- Tốt hơn BoltDB (legacy)

**2. Schema v13:**
- Latest schema version
- Tối ưu cho TSDB

**3. Index period: 24h**
- Tạo index mới mỗi ngày
- File: `index_2025-12-30`
- Trade-off:
  - 24h: Balance giữa file size và query performance
  - 12h: Nhiều files, query phức tạp hơn
  - 168h (7d): Ít files, nhưng file lớn

#### Compactor - Nén và Retention

```yaml
compactor:
  working_directory: /loki/compactor
  compaction_interval: 10m
  retention_enabled: true
  retention_delete_delay: 2h
  retention_delete_worker_count: 150
  delete_request_store: filesystem
```

**Compaction workflow:**

```
Ingester tạo chunks:
chunk-001 (0-10min, 10MB)
chunk-002 (10-20min, 12MB)
chunk-003 (20-30min, 8MB)
...

Compactor (mỗi 10 phút):
1. Merge chunks: chunk-001 + chunk-002 + chunk-003 → chunk-hour-1 (25MB)
2. Compress: chunk-hour-1 (25MB) → chunk-hour-1.gz (5MB)
3. Delete old chunks
```

**Lợi ích:**
- **Storage**: 10MB + 12MB + 8MB = 30MB → 5MB (83% savings)
- **Query**: Đọc 1 file thay vì 3 files
- **I/O**: Ít file operations

**Retention:**
```yaml
limits_config:
  retention_period: 168h  # 7 days
```

**Deletion workflow:**
```
Day 1: Ingest logs
Day 2-7: Keep logs
Day 8: Compactor marks for deletion
Day 8 + 2h: Actually delete (retention_delete_delay)
```

**Tại sao delay 2h?**
- Queries đang chạy có thể đọc chunks
- Delay đảm bảo queries hoàn thành
- Tránh "file not found" errors

#### Limits Config

```yaml
limits_config:
  retention_period: 168h
  reject_old_samples: false
  reject_old_samples_max_age: 8760h  # 1 year
  creation_grace_period: 8760h
  ingestion_rate_mb: 50
  ingestion_burst_size_mb: 100
  max_streams_per_user: 0  # unlimited
  max_line_size: 256KB
  split_queries_by_interval: 15m
```

**Giải thích từng config:**

**1. reject_old_samples: false**
```
Scenario: Promtail restart, đọc lại logs từ 2 ngày trước

reject_old_samples: true
  → Loki reject: "Log too old"
  → Mất logs

reject_old_samples: false
  → Loki accept
  → Có thể có duplicates, nhưng không mất data
```

**2. max_age: 8760h (1 year)**
- Chấp nhận logs tối đa 1 năm tuổi
- Tránh spam từ corrupted timestamps

**3. ingestion_rate_mb: 50**
```
Normal: 10MB/s → OK
Spike: 60MB/s → Throttled (429 error)
```

**Tại sao throttle?**
- Bảo vệ Loki khỏi overload
- Promtail retry sau

**4. ingestion_burst_size_mb: 100**
```
Burst: Cho phép vượt rate limit trong thời gian ngắn
Example:
  - 0-1s: 100MB (burst)
  - 1-2s: 50MB (normal rate)
  - 2-3s: 50MB
```

**5. max_streams_per_user: 0 (unlimited)**

**Stream** = unique label combination:
```
{job="api", level="info"}     → stream 1
{job="api", level="error"}    → stream 2
{job="db", level="info"}      → stream 3
```

**Vấn đề high cardinality:**
```yaml
# BAD: user_id in labels
{job="api", user_id="123"}
{job="api", user_id="456"}
{job="api", user_id="789"}
...
→ 1 million users = 1 million streams → OOM
```

**Good practice:**
```yaml
# GOOD: user_id in log content
{job="api", level="info"}
log: "User 123 logged in"
```

**6. split_queries_by_interval: 15m**

**Query:**
```logql
{job="api"} | json | line_format "{{.message}}"
  [last 24 hours]
```

**Without split:**
```
1 query: Scan 24 hours of data
→ Timeout, OOM
```

**With split (15m intervals):**
```
Query 1: 00:00-00:15
Query 2: 00:15-00:30
...
Query 96: 23:45-24:00

→ Parallel execution
→ Faster, more reliable
```

#### Ruler - Alerting

```yaml
ruler:
  alertmanager_url: http://alertmanager:9093
```

**Loki alerting:**
```yaml
# loki-rules.yml
groups:
  - name: errors
    interval: 1m
    rules:
      - alert: HighErrorRate
        expr: |
          sum(rate({job="api"} |= "error" [5m])) > 10
        for: 5m
        annotations:
          summary: "High error rate in API"
```

**Workflow:**
```
Loki Ruler (mỗi 1 phút)
  → Run LogQL query
  → If condition true for 5m
  → Send alert to Alertmanager
  → Alertmanager route to Telegram
```

### 3. LogQL - Query Language

**LogQL** giống PromQL, nhưng cho logs.

#### Log Stream Selector

```logql
# Basic
{job="api"}

# Multiple labels
{job="api", level="error"}

# Regex
{job=~"api|web"}
{job!~"test.*"}
```

#### Line Filter

```logql
# Contains
{job="api"} |= "error"

# Not contains
{job="api"} != "debug"

# Regex
{job="api"} |~ "error|exception|failed"

# Case-insensitive
{job="api"} |~ "(?i)error"
```

#### Parser

**JSON:**
```logql
{job="api"} | json
```

**Input:**
```json
{"level":"error","message":"DB timeout","user_id":123}
```

**Output:** Extract fields as labels
```
level="error"
message="DB timeout"
user_id="123"
```

**Logfmt:**
```logql
{job="api"} | logfmt
```

**Input:**
```
level=error message="DB timeout" user_id=123
```

**Regex:**
```logql
{job="api"} | regexp "(?P<method>\\w+) (?P<path>/\\S+) (?P<status>\\d+)"
```

**Input:**
```
GET /api/users 200
```

**Output:**
```
method="GET"
path="/api/users"
status="200"
```

#### Label Filter (after parsing)

```logql
{job="api"} 
  | json 
  | level="error"
  | status_code >= 500
```

#### Line Format

```logql
{job="api"} 
  | json 
  | line_format "{{.timestamp}} [{{.level}}] {{.message}}"
```

**Input:**
```json
{"timestamp":"2025-12-30T15:30:45Z","level":"ERROR","message":"Timeout"}
```

**Output:**
```
2025-12-30T15:30:45Z [ERROR] Timeout
```

#### Aggregation

```logql
# Count
count_over_time({job="api"} |= "error" [5m])

# Rate (logs per second)
rate({job="api"} [5m])

# Sum extracted values
sum(rate({job="api"} | json | unwrap bytes [5m]))

# Quantile
quantile_over_time(0.95, {job="api"} | json | unwrap duration [5m])
```

#### Useful Queries

**Error rate:**
```logql
sum(rate({job="api"} |= "error" [5m])) by (service)
```

**Top error messages:**
```logql
topk(10, 
  sum by (message) (
    count_over_time({job="api", level="error"} | json [1h])
  )
)
```

**Slow queries:**
```logql
{job="postgres"} 
  | regexp "duration: (?P<duration>\\d+\\.\\d+) ms"
  | duration > 1000
```

**Failed logins:**
```logql
{job="auth"} 
  |= "login failed"
  | json
  | line_format "{{.timestamp}} {{.username}} {{.ip}}"
```

## 💡 Best Practices

### 1. Label Design

**Good (low cardinality):**
```
{job="api", env="prod", level="error"}
```

**Bad (high cardinality):**
```
{job="api", user_id="123", request_id="abc-def"}
```

**Rule:** Labels nên có < 100 unique values.

### 2. Structured Logging

**Good (JSON):**
```json
{"timestamp":"2025-12-30T15:30:45Z","level":"ERROR","message":"DB timeout","user_id":123,"duration_ms":5000}
```

**Bad (unstructured):**
```
[2025-12-30 15:30:45] ERROR: Database timeout for user 123 after 5000ms
```

**Lợi ích structured:**
- Dễ parse với `| json`
- Extract fields thành labels
- Aggregate, filter chính xác

### 3. Log Levels

```
TRACE: Very detailed (disabled in prod)
DEBUG: Detailed info for debugging
INFO: General informational messages
WARN: Warning, potential issues
ERROR: Errors, but app still running
FATAL: Critical errors, app crash
```

**Best practice:**
- Production: INFO và cao hơn
- Development: DEBUG
- Troubleshooting: TRACE (tạm thời)

### 4. Context in Logs

**Good:**
```json
{
  "level": "error",
  "message": "Payment failed",
  "user_id": 123,
  "order_id": "abc-123",
  "payment_method": "credit_card",
  "amount": 99.99,
  "error_code": "CARD_DECLINED",
  "trace_id": "xyz-789"
}
```

**Bad:**
```
ERROR: Payment failed
```

**Include:**
- User/session context
- Request context
- Error details
- Trace ID (link to distributed tracing)

## 🎓 Tổng kết

### Logging Flow Summary

1. **Applications** ghi logs (stdout/stderr/files)
2. **Promtail** thu thập logs từ Docker, files, system
3. **Pipeline stages** parse, label, filter logs
4. **Loki** nhận logs, index labels, store chunks
5. **Compactor** nén và xóa logs cũ
6. **Grafana** query logs với LogQL, visualize

### Key Takeaways

✅ **Logs = Event records với timestamp và context**  
✅ **Loki = Label-based indexing (like Prometheus)**  
✅ **Promtail = Log collector với powerful pipelines**  
✅ **LogQL = Query language giống PromQL**  
✅ **Structured logging = Dễ parse và analyze**  
✅ **Low cardinality labels = Hiệu quả và scalable**  

### Khi nào dùng Logs?

- ✅ Debugging chi tiết (stack traces, errors)
- ✅ Audit trail (who did what when)
- ✅ Security investigations
- ✅ Business analytics (user behavior)
- ✅ Compliance (GDPR, SOC2)
- ❌ System-wide trends (dùng Metrics)
- ❌ Request tracing (dùng Traces)
- ❌ Real-time alerting (dùng Metrics, nhanh hơn)

### So sánh 3 Pillars

| Use Case | Logs | Metrics | Traces |
|----------|------|---------|--------|
| "Tại sao API chậm?" | ❌ | ⚠️ Biết chậm | ✅ Biết chậm ở đâu |
| "Có bao nhiêu errors?" | ⚠️ Count | ✅ Counter | ❌ |
| "Error message là gì?" | ✅ | ❌ | ⚠️ Span events |
| "Ai xóa user này?" | ✅ Audit log | ❌ | ❌ |
| "CPU usage trend?" | ❌ | ✅ | ❌ |
| "Request đi qua services nào?" | ❌ | ❌ | ✅ |

**Best practice:** Dùng cả 3 kết hợp!
- **Metrics**: Phát hiện vấn đề
- **Traces**: Tìm bottleneck
- **Logs**: Debug chi tiết
