# METRICS - Hệ thống Thu thập và Giám sát Metrics

## 🎯 Metrics là gì và Tại sao cần Metrics?

### Định nghĩa
**Metrics** là các phép đo số lượng (numerical measurements) được thu thập theo thời gian để theo dõi trạng thái và hiệu suất của hệ thống. Khác với logs (ghi lại sự kiện rời rạc) hay traces (theo dõi luồng request), metrics cung cấp cái nhìn tổng quan về xu hướng và patterns qua thời gian.

### Tại sao Metrics quan trọng?

1. **Phát hiện vấn đề sớm**: Metrics cho phép bạn nhìn thấy xu hướng trước khi vấn đề nghiêm trọng xảy ra
   - CPU tăng dần → cảnh báo trước khi server crash
   - Memory leak → phát hiện qua memory usage tăng liên tục
   - Disk đầy → cảnh báo khi còn 20% thay vì đợi đến 0%

2. **Hiểu hiệu suất hệ thống**: 
   - Response time của API
   - Throughput (requests/second)
   - Error rate
   - Database query performance

3. **Capacity Planning**: Dựa vào xu hướng để dự đoán khi nào cần scale
   - "Traffic tăng 20%/tháng → 3 tháng nữa cần thêm server"

4. **SLA/SLO Monitoring**: Đảm bảo đáp ứng cam kết với khách hàng
   - 99.9% uptime
   - Response time < 200ms cho 95% requests

## 🏗️ Kiến trúc Metrics trong Hệ thống

```
┌─────────────────────────────────────────────────────────────────┐
│                    METRICS COLLECTION FLOW                       │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────┐         ┌──────────────────┐
│  Target Systems  │         │    Exporters     │
│                  │         │                  │
│  • PostgreSQL    │────────▶│ • Postgres       │
│  • MongoDB       │         │   Exporter       │
│  • Servers       │         │ • MongoDB        │
│  • Containers    │         │   Exporter       │
│  • Applications  │         │ • Node Exporter  │
│                  │         │ • cAdvisor       │
└──────────────────┘         └────────┬─────────┘
                                      │
                                      │ HTTP /metrics endpoint
                                      │ (Pull model)
                                      ▼
                             ┌─────────────────┐
                             │   Prometheus    │
                             │                 │
                             │ • Scrape metrics│
                             │ • Store TSDB    │
                             │ • Evaluate rules│
                             │ • Send alerts   │
                             └────┬────────┬───┘
                                  │        │
                    ┌─────────────┘        └──────────────┐
                    │                                     │
                    ▼                                     ▼
           ┌─────────────────┐                  ┌─────────────────┐
           │  Alertmanager   │                  │    Grafana      │
           │                 │                  │                 │
           │ • Route alerts  │                  │ • Visualize     │
           │ • Group alerts  │                  │ • Dashboards    │
           │ • Send to       │                  │ • Query PromQL  │
           │   Telegram      │                  │                 │
           └─────────────────┘                  └─────────────────┘
```

## 🔧 Các Thành phần Chi tiết

### 1. Prometheus - Time Series Database

**Vai trò**: Trung tâm của hệ thống metrics, chịu trách nhiệm thu thập, lưu trữ và query metrics.

#### Cách hoạt động

**Pull Model** (khác với push model):
- Prometheus chủ động "kéo" (scrape) metrics từ các targets
- Targets expose metrics qua HTTP endpoint `/metrics`
- Scrape interval: mỗi 15 giây (cấu hình: `scrape_interval: 15s`)

**Tại sao Pull thay vì Push?**
- **Service Discovery**: Prometheus tự động phát hiện targets mới/mất
- **Centralized Control**: Dễ kiểm soát tần suất thu thập
- **Reliability**: Target down không ảnh hưởng đến Prometheus
- **Debugging**: Dễ dàng kiểm tra metrics bằng cách curl endpoint

#### Time Series Database (TSDB)

Prometheus sử dụng TSDB tối ưu cho dữ liệu time-series:

```
Metric Structure:
metric_name{label1="value1", label2="value2"} value timestamp

Ví dụ:
http_requests_total{method="GET", endpoint="/api/users", status="200"} 1547 1735574400
```

**Đặc điểm TSDB:**
- **Compression**: Nén dữ liệu hiệu quả (10-100x)
- **Block Storage**: Chia data thành blocks 2 giờ
- **Retention**: Giữ data 15 ngày (có thể cấu hình)
- **Fast Query**: Tối ưu cho range queries

#### Cấu hình trong hệ thống

```yaml
# prometheus.yml
global:
  scrape_interval: 15s      # Thu thập mỗi 15s
  evaluation_interval: 15s  # Đánh giá alert rules mỗi 15s

scrape_configs:
  # Tự monitor chính nó
  - job_name: "prometheus"
    static_configs:
      - targets: ["localhost:9090"]
  
  # Monitor các components
  - job_name: "alertmanager"
    static_configs:
      - targets: ["alertmanager:9093"]
  
  # Database exporters với labels
  - job_name: "mongodb-exporter"
    static_configs:
      - targets: ["mongodb-exporter-ptit:9216"]
        labels:
          cluster: "main"
          service: "mongodb"
          instance: "ptit"
      - targets: ["10.99.3.67:9216"]
        labels:
          cluster: "test"
          service: "mongodb"
          instance: "test"
```

**Giải thích Labels:**
- `job`: Nhóm các targets cùng mục đích
- `instance`: Định danh cụ thể target nào
- Custom labels (`cluster`, `service`): Phân loại và filter khi query

### 2. Exporters - Cầu nối giữa Services và Prometheus

**Exporters** là các service nhỏ chuyển đổi metrics từ hệ thống không hỗ trợ Prometheus format sang format mà Prometheus hiểu được.

#### PostgreSQL Exporter

**Nguồn**: `bitnami/postgres-exporter`

**Cách hoạt động:**
1. Kết nối đến PostgreSQL qua connection string
2. Chạy các SQL queries để lấy thông tin
3. Chuyển đổi kết quả thành Prometheus metrics
4. Expose qua port 9187

**Metrics thu thập:**

```promql
# Database size
pg_database_size_bytes{datname="mydb"}

# Active connections
pg_stat_activity_count{datname="mydb", state="active"}

# Transaction stats
pg_stat_database_xact_commit{datname="mydb"}
pg_stat_database_xact_rollback{datname="mydb"}

# Query duration (từ pg_stat_activity)
pg_stat_activity_max_tx_duration{datname="mydb", state="active"}

# Table statistics
pg_stat_user_tables_seq_scan{datname="mydb", schemaname="public", relname="users"}
pg_stat_user_tables_idx_scan{datname="mydb", schemaname="public", relname="users"}
```

**Cấu hình:**
```yaml
environment:
  - DATA_SOURCE_NAME=postgresql://user:pass@postgres:5432/db?sslmode=disable
  - PG_EXPORTER_AUTO_DISCOVER_DATABASES=true  # Tự động discover DBs
  - PG_EXPORTER_EXCLUDE_DATABASES=template0,template1  # Loại trừ system DBs
```

**Tại sao cần exclude templates?**
- `template0`, `template1` là system databases
- Không cần monitor vì không có user data
- Giảm cardinality (số lượng time series)

#### MongoDB Exporter

**Nguồn**: `percona/mongodb_exporter:0.40`

**Cách hoạt động:**
1. Kết nối MongoDB qua URI
2. Chạy các admin commands: `serverStatus`, `dbStats`, `replSetGetStatus`
3. Parse kết quả và expose metrics

**Metrics thu thập:**

```promql
# Uptime và availability
mongodb_up

# Connections
mongodb_connections{conn_type="current"}
mongodb_connections{conn_type="available"}

# Operations
mongodb_op_counters_total{type="query"}
mongodb_op_counters_total{type="insert"}
mongodb_op_counters_total{type="update"}

# Latency (microseconds)
mongodb_ss_opLatencies_latency{type="reads"}
mongodb_ss_opLatencies_latency{type="writes"}
mongodb_ss_opLatencies_ops{type="reads"}

# Memory
mongodb_memory{type="resident"}
mongodb_memory{type="virtual"}

# WiredTiger Cache
mongodb_mongod_wiredtiger_cache_pages_read_total
mongodb_mongod_wiredtiger_cache_pages_requested_from_cache_total

# Replication
mongodb_mongod_replset_member_replication_lag
mongodb_mongod_replset_member_health
```

**Cấu hình:**
```yaml
command:
  - "--mongodb.uri=mongodb://admin:pass@mongodb:27017"
  - "--collect-all"              # Thu thập tất cả metrics
  - "--compatible-mode"          # Tương thích với MongoDB cũ
  - "--collector.replicasetstatus"  # Bật replica set metrics
  - "--discovering-mode"         # Tự động discover databases
```

**Giải thích flags:**
- `--collect-all`: Mặc định chỉ collect metrics cơ bản, flag này collect hết
- `--compatible-mode`: Hỗ trợ cả MongoDB 3.x, 4.x, 5.x
- `--discovering-mode`: Tự động tìm và monitor các databases mới

#### Node Exporter (File-based Service Discovery)

**Cấu hình:**
```yaml
- job_name: "node_exporter"
  file_sd_configs:
    - files:
        - /etc/prometheus/targets.node.json
```

**Tại sao dùng file_sd_configs?**
- **Dynamic targets**: Thêm/bớt servers không cần restart Prometheus
- **External management**: Script/automation có thể update file
- **Separation of concerns**: Cấu hình targets tách khỏi prometheus.yml

**Format file targets.node.json:**
```json
[
  {
    "targets": ["10.99.3.67:9100", "10.99.3.68:9100"],
    "labels": {
      "env": "production",
      "datacenter": "dc1"
    }
  }
]
```

### 3. Recording Rules và Alert Rules

#### Recording Rules - Pre-compute Queries

**Mục đích**: Tính toán trước các queries phức tạp, lưu kết quả thành metrics mới.

**Tại sao cần Recording Rules?**
1. **Performance**: Query phức tạp chạy 1 lần/15s thay vì mỗi lần user mở dashboard
2. **Consistency**: Tất cả dashboards dùng cùng 1 cách tính
3. **Simplicity**: Dashboard queries đơn giản hơn

**Ví dụ:**
```yaml
# Thay vì query phức tạp này mỗi lần:
(
  rate(mongodb_ss_opLatencies_latency{type="reads"}[5m]) 
  / 
  rate(mongodb_ss_opLatencies_ops{type="reads"}[5m])
)

# Tạo recording rule:
- record: mongodb:read_latency:avg5m
  expr: |
    rate(mongodb_ss_opLatencies_latency{type="reads"}[5m]) 
    / 
    rate(mongodb_ss_opLatencies_ops{type="reads"}[5m])

# Dashboard chỉ cần query:
mongodb:read_latency:avg5m
```

#### Alert Rules - Phát hiện Vấn đề

Alert rules định nghĩa điều kiện để trigger cảnh báo.

**Anatomy của một Alert:**

```yaml
- alert: MongoDBSlowQueries
  expr: |
    (
      rate(mongodb_ss_opLatencies_latency{type="commands"}[5m]) 
      / 
      rate(mongodb_ss_opLatencies_ops{type="commands"}[5m])
    ) > 100000
  for: 10m
  labels:
    severity: warning
    component: mongodb
    alert_type: performance
  annotations:
    summary: "MongoDB {{ $labels.instance }} has slow queries"
    description: "Average query latency is {{ $value | humanize }}μs (>100ms)"
```

**Giải thích từng phần:**

1. **`expr`**: PromQL expression định nghĩa điều kiện
   - Tính average latency trong 5 phút
   - Alert nếu > 100,000 microseconds (100ms)

2. **`for: 10m`**: Pending duration
   - Điều kiện phải đúng liên tục 10 phút mới fire alert
   - Tránh false positive từ spike tạm thời

3. **`labels`**: Metadata để routing và grouping
   - `severity`: critical/warning/info → quyết định notification channel
   - `component`: mongodb/postgres → group alerts theo service
   - `alert_type`: performance/availability/security → phân loại

4. **`annotations`**: Thông tin hiển thị trong alert
   - `{{ $labels.instance }}`: Template variable
   - `{{ $value | humanize }}`: Format số đẹp hơn

#### Alert Rules trong Hệ thống

**1. System Alerts** (`rules.alert.yml`):

```yaml
- alert: HighCPUUsage
  expr: (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m]))) * 100 > 90
  for: 5m
  labels:
    severity: critical
  annotations:
    description: "CPU sử dụng trên 90%"
```

**Giải thích công thức:**
- `node_cpu_seconds_total{mode="idle"}`: Thời gian CPU idle
- `rate(...[5m])`: Tốc độ thay đổi trong 5 phút
- `1 - avg(...)`: Đảo ngược để có CPU usage
- `* 100`: Convert sang phần trăm

**2. PostgreSQL Alerts** (`rules.postgres.yml`):

```yaml
- alert: PostgreSQLLongRunningQueries
  expr: |
    max by (datname, usename, query, pid, state, instance) (
      pg_stat_activity_max_tx_duration{state!='idle'}
    ) > 300
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Long running query detected on {{ $labels.instance }}"
    description: |
      Query đang chạy lâu trên database:
      - Database: {{ $labels.datname }}
      - User: {{ $labels.usename }}
      - Process ID: {{ $labels.pid }}
      - Thời gian chạy: {{ $value | humanizeDuration }}
      - Query: {{ $labels.query }}
```

**Tại sao group by nhiều labels?**
- Mỗi query khác nhau = 1 alert riêng
- Biết chính xác query nào, user nào, database nào
- Có thể kill process bằng PID

**3. MongoDB Alerts** (`rules.mongodb.yml`):

```yaml
- alert: MongoDBReplicationLagCritical
  expr: mongodb_mongod_replset_member_replication_lag > 30
  for: 5m
  labels:
    severity: critical
    component: mongodb
    alert_type: replication
  annotations:
    summary: "MongoDB replication lag is critical on {{ $labels.instance }}"
    description: "Replication lag is {{ $value }} seconds. This may cause data inconsistency."
```

**Replication Lag là gì?**
- Trong replica set, secondary nodes copy data từ primary
- Lag = khoảng thời gian secondary chậm hơn primary
- Lag > 30s = nguy cơ mất data nếu primary fail

### 4. Alertmanager - Alert Routing và Notification

**Vai trò**: Nhận alerts từ Prometheus, group, deduplicate, và gửi notifications.

#### Workflow

```
Prometheus                Alertmanager              Receivers
    │                          │                        │
    │  Alert: CPU > 90%        │                        │
    ├─────────────────────────▶│                        │
    │  Alert: Memory > 80%     │                        │
    ├─────────────────────────▶│                        │
    │                          │                        │
    │                          │  Group alerts          │
    │                          │  (same cluster)        │
    │                          │                        │
    │                          │  Wait 30s for more     │
    │                          │                        │
    │                          │  Send grouped alert    │
    │                          ├───────────────────────▶│ Telegram
    │                          │                        │
    │  Alert: CPU resolved     │                        │
    ├─────────────────────────▶│                        │
    │                          │  Send resolution       │
    │                          ├───────────────────────▶│ Telegram
```

**Tính năng chính:**

1. **Grouping**: Gộp nhiều alerts thành 1 notification
   ```yaml
   group_by: ['cluster', 'alertname']
   ```
   - Tránh spam: 10 servers cùng lỗi = 1 message thay vì 10

2. **Inhibition**: Suppress alerts phụ thuộc
   - Server down → không cần alert về services trên server đó

3. **Silencing**: Tắt alerts tạm thời
   - Đang maintenance → silence alerts 2 giờ

4. **Routing**: Gửi alerts đến đúng người/channel
   ```yaml
   routes:
     - match:
         severity: critical
       receiver: telegram-critical
     - match:
         severity: warning
       receiver: telegram-warning
   ```

#### Cấu hình trong hệ thống

```yaml
entrypoint: ["/bin/sh", "-c"]
command:
  - |
    sed "s|\$${TELEGRAM_BOT_TOKEN}|${TELEGRAM_BOT_TOKEN}|g; 
         s|\$${TELEGRAM_CHAT_ID}|${TELEGRAM_CHAT_ID}|g" \
      /etc/alertmanager/alertmanager.yml.template > /tmp/alertmanager.yml && \
    /bin/alertmanager \
      --config.file=/tmp/alertmanager.yml \
      --storage.path=/alertmanager \
      --web.external-url=${ALERTMANAGER_URL}
```

**Giải thích:**
- Sử dụng template file để inject secrets từ environment variables
- Tránh commit sensitive data (bot token, chat ID) vào git
- Generate config file runtime từ template

### 5. Grafana - Visualization

**Vai trò**: Query Prometheus và hiển thị metrics dưới dạng dashboards, graphs, tables.

#### Prometheus Data Source

Grafana kết nối Prometheus qua HTTP API:
```
http://prometheus:9090
```

#### PromQL trong Grafana

**Instant Query** (giá trị hiện tại):
```promql
mongodb_connections{conn_type="current"}
```

**Range Query** (time series):
```promql
rate(mongodb_op_counters_total{type="query"}[5m])
```

**Aggregation** (tổng hợp):
```promql
sum by (instance) (mongodb_connections{conn_type="current"})
```

#### Dashboard Best Practices

1. **USE Method** (Utilization, Saturation, Errors):
   - **Utilization**: % resource đang dùng (CPU, Memory, Disk)
   - **Saturation**: Queued work (connection pool, queue length)
   - **Errors**: Error rate, failed requests

2. **RED Method** (Rate, Errors, Duration) - cho services:
   - **Rate**: Requests per second
   - **Errors**: Error rate
   - **Duration**: Response time (p50, p95, p99)

3. **Golden Signals**:
   - Latency
   - Traffic
   - Errors
   - Saturation

## 🔍 PromQL - Query Language

### Metric Types

#### 1. Counter
Giá trị chỉ tăng (hoặc reset về 0):
```promql
http_requests_total
mongodb_op_counters_total
```

**Sử dụng với `rate()` hoặc `increase()`:**
```promql
# Requests per second
rate(http_requests_total[5m])

# Total requests trong 1 giờ
increase(http_requests_total[1h])
```

#### 2. Gauge
Giá trị có thể tăng/giảm:
```promql
mongodb_connections{conn_type="current"}
node_memory_MemAvailable_bytes
```

**Sử dụng trực tiếp hoặc với aggregation:**
```promql
# Current value
mongodb_connections{conn_type="current"}

# Average over time
avg_over_time(mongodb_connections{conn_type="current"}[5m])
```

#### 3. Histogram
Phân bố giá trị (thường cho latency):
```promql
http_request_duration_seconds_bucket{le="0.1"}  # <= 100ms
http_request_duration_seconds_bucket{le="0.5"}  # <= 500ms
http_request_duration_seconds_sum
http_request_duration_seconds_count
```

**Tính percentile:**
```promql
# p95 latency
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))
```

### Useful Queries

**Database Performance:**
```promql
# MongoDB average query latency
rate(mongodb_ss_opLatencies_latency{type="commands"}[5m]) 
/ 
rate(mongodb_ss_opLatencies_ops{type="commands"}[5m])

# PostgreSQL active connections
pg_stat_activity_count{state="active"}

# PostgreSQL transaction rate
rate(pg_stat_database_xact_commit[5m])
```

**System Resources:**
```promql
# CPU usage per core
100 - (avg by (cpu) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)

# Memory usage percentage
(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100

# Disk I/O
rate(node_disk_read_bytes_total[5m])
rate(node_disk_written_bytes_total[5m])
```

## 💡 Best Practices

### 1. Label Design

**Good:**
```promql
http_requests_total{method="GET", endpoint="/api/users", status="200"}
```

**Bad (high cardinality):**
```promql
http_requests_total{user_id="12345", request_id="abc-def-ghi"}
```

**Tại sao?**
- Mỗi unique label combination = 1 time series
- `user_id` có hàng triệu giá trị → hàng triệu time series → out of memory
- Chỉ dùng labels có số lượng giá trị hữu hạn (< 1000)

### 2. Scrape Interval

**Trade-offs:**
- **15s**: Cân bằng tốt, phát hiện vấn đề nhanh, overhead chấp nhận được
- **30s-1m**: Giảm overhead, nhưng miss spike ngắn
- **5s**: Độ chi tiết cao, nhưng tốn storage và CPU

**Khuyến nghị:**
- Production critical: 15s
- Non-critical: 30s-1m
- High-frequency metrics: 5-10s

### 3. Retention

```yaml
--storage.tsdb.retention.time=15d
--storage.tsdb.retention.size=50GB
```

**Chiến lược:**
- **Short-term** (Prometheus): 7-15 ngày, độ chi tiết cao
- **Long-term** (Thanos/Cortex): Tháng/năm, downsampled
- **Aggregated** (Recording rules): Giữ mãi, chỉ metrics quan trọng

### 4. Alert Tuning

**Tránh alert fatigue:**
- `for: 10m` thay vì `for: 1m` → chờ confirm vấn đề thực sự
- Severity đúng: critical chỉ cho vấn đề cần xử lý ngay
- Actionable: Alert phải có hướng xử lý rõ ràng

**Good alert:**
```yaml
- alert: DatabaseConnectionPoolExhausted
  expr: mongodb_connections{conn_type="available"} < 10
  for: 5m
  annotations:
    summary: "MongoDB connection pool nearly exhausted"
    description: "Only {{ $value }} connections available. Check for connection leaks."
    runbook: "https://wiki.company.com/runbooks/mongodb-connections"
```

## 🎓 Tổng kết

### Metrics Flow Summary

1. **Exporters** chuyển đổi metrics từ services → Prometheus format
2. **Prometheus** scrape metrics mỗi 15s, lưu vào TSDB
3. **Recording rules** pre-compute queries phức tạp
4. **Alert rules** đánh giá điều kiện, fire alerts
5. **Alertmanager** group và route alerts đến Telegram
6. **Grafana** query Prometheus, visualize dashboards

### Key Takeaways

✅ **Metrics = Numerical measurements over time**  
✅ **Pull model** = Prometheus scrapes targets  
✅ **Labels** = Dimensions để filter và aggregate  
✅ **PromQL** = Query language mạnh mẽ  
✅ **Alerts** = Automated problem detection  
✅ **Exporters** = Bridge giữa services và Prometheus  

### Khi nào dùng Metrics?

- ✅ Theo dõi xu hướng (CPU, memory, disk usage)
- ✅ Performance monitoring (latency, throughput)
- ✅ Capacity planning (growth trends)
- ✅ SLA/SLO tracking (uptime, response time)
- ❌ Debugging chi tiết (dùng Logs)
- ❌ Request tracing (dùng Traces)
- ❌ Audit trail (dùng Logs)
