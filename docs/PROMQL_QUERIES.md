# 📊 PromQL Query Examples

Tài liệu này cung cấp các câu lệnh PromQL (Prometheus Query Language) mẫu, được tối ưu cho các Exporter đang sử dụng trong hệ thống `monitor-repo`.

## 🖥️ 1. Node Exporter (System Resources)

Giám sát CPU, RAM, Disk cho Linux Servers.

### CPU
```promql
# CPU Usage (%) - trung bình 5 phút
100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)

# CPU Usage per Core
(1 - rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100
```

### Memory
```promql
# RAM Usage (%)
(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100

# RAM còn trống (GB)
node_memory_MemAvailable_bytes / 1024 / 1024 / 1024
```

### Disk & Filesystem
```promql
# Disk Usage (%) - loại bỏ các filesystem ảo
100 - ((node_filesystem_avail_bytes{fstype!~"tmpfs|fuse.*"} / node_filesystem_size_bytes) * 100)

# Dự báo Disk đầy trong 24h tới (Alerting)
predict_linear(node_filesystem_free_bytes[1h], 24 * 3600) < 0
```

---

## 🗄️ 2. Database Monitoring

### PostgreSQL (`postgres_exporter`)
```promql
# Số lượng kết nối đang Active
pg_stat_activity_count{state="active"}

# Connection Pool Usage (%)
sum(pg_stat_activity_count) by (instance) / sum(pg_settings_max_connections) by (instance) * 100

# Tỷ lệ Transaction Rollback (Cần chú ý nếu > 10%)
rate(pg_stat_database_xact_rollback[5m]) / (rate(pg_stat_database_xact_commit[5m]) + rate(pg_stat_database_xact_rollback[5m]))
```

### MongoDB (`mongodb_exporter`)
```promql
# MongoDB Up status (1 = Up, 0 = Down)
mongodb_up

# Số lượng connections hiện tại
mongodb_connections{state="current"}

# Replication Lag (quan trọng cho Replica Set)
mongodb_mongod_replset_member_optime_date{state="PRIMARY"} - mongodb_mongod_replset_member_optime_date{state="SECONDARY"}
```

---

## 🐳 3. Containers (`cadvisor`)

```promql
# Container CPU Usage
rate(container_cpu_usage_seconds_total{image!=""}[1m]) * 100

# Container Memory Usage (MB)
container_memory_usage_bytes{image!=""} / 1024 / 1024

# Network Traffic (Receive)
rate(container_network_receive_bytes_total[5m])
```

---

## 🌐 4. Nginx (`nginx-prometheus-exporter`)

```promql
# Request Rate (Requests/second)
rate(nginx_http_requests_total[1m])

# Error Rate (4xx/5xx)
rate(nginx_http_requests_total{status=~"^5.."}[1m])
rate(nginx_http_requests_total{status=~"^4.."}[1m])

# Active Connections
nginx_connections_active
```

---

## ⚡ 5. Application (Red Metrics via Tempo/OTLP)

Nếu ứng dụng gửi metrics qua OTLP, các metrics này thường có prefix `traces_spanmetrics_` (nếu dùng Tempo SpanMetrics).

```promql
# Request Rate (R) - req/s
sum(rate(traces_spanmetrics_calls_total[1m])) by (service_name)

# Error Rate (E) - %
sum(rate(traces_spanmetrics_calls_total{status_code="STATUS_CODE_ERROR"}[1m])) by (service_name) 
/ 
sum(rate(traces_spanmetrics_calls_total[1m])) by (service_name)

# Duration (D) - P95 Latency
histogram_quantile(0.95, sum(rate(traces_spanmetrics_latency_bucket[5m])) by (le, service_name))
```
