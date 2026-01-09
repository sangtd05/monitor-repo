# SRE Best Practices & Monitoring Standards

## 📊 Tổng quan

Site Reliability Engineering (SRE) là discipline kết hợp software engineering và operations để xây dựng và vận hành hệ thống production đáng tin cậy, có khả năng mở rộng.

Tài liệu này tổng hợp các best practices và tiêu chuẩn đánh giá cho hệ thống monitoring.

---

## 🎯 The Four Golden Signals (Google SRE)

Google SRE định nghĩa **4 metrics quan trọng nhất** để monitor bất kỳ hệ thống nào:

### 1. **Latency** - Độ trễ

**Định nghĩa:** Thời gian để xử lý một request.

**Tại sao quan trọng:**
- Ảnh hưởng trực tiếp đến user experience
- Phát hiện performance degradation sớm
- Indicator của resource contention

**Metrics:**
```promql
# HTTP request latency (p50, p95, p99)
histogram_quantile(0.95, 
  rate(http_request_duration_seconds_bucket[5m])
)

# Database query latency
rate(mongodb_ss_opLatencies_latency{type="reads"}[5m]) 
/ 
rate(mongodb_ss_opLatencies_ops{type="reads"}[5m])
```

**Best practices:**
- ✅ Track percentiles (p50, p95, p99), không chỉ average
- ✅ Phân biệt successful vs failed request latency
- ✅ Set SLO: "95% requests < 200ms"
- ⚠️ Đừng chỉ nhìn average (bị skew bởi outliers)

---

### 2. **Traffic** - Lưu lượng

**Định nghĩa:** Số lượng requests hệ thống đang xử lý.

**Tại sao quan trọng:**
- Hiểu demand patterns
- Capacity planning
- Phát hiện DDoS hoặc traffic spikes

**Metrics:**
```promql
# Requests per second
rate(http_requests_total[5m])

# Database operations per second
rate(mongodb_op_counters_total[5m])

# Active connections
pg_stat_activity_count{state="active"}
```

**Best practices:**
- ✅ Track by endpoint/service
- ✅ Phân tích traffic patterns (daily, weekly cycles)
- ✅ Alert trên sudden changes (>50% increase)
- ✅ Correlate với business metrics (orders, signups)

---

### 3. **Errors** - Lỗi

**Định nghĩa:** Tỷ lệ requests thất bại.

**Tại sao quan trọng:**
- Trực tiếp ảnh hưởng reliability
- Indicator của bugs hoặc infrastructure issues
- Critical cho SLA compliance

**Metrics:**
```promql
# Error rate
rate(http_requests_total{status=~"5.."}[5m]) 
/ 
rate(http_requests_total[5m])

# Database errors
rate(mongodb_ss_opcounters_repl_total{type="failed"}[5m])

# Application errors from logs
sum(rate({service="api", level="error"}[5m]))
```

**Best practices:**
- ✅ Track error rate (%), không chỉ absolute count
- ✅ Categorize errors: 4xx (client) vs 5xx (server)
- ✅ Alert trên error rate > threshold (e.g., 1%)
- ✅ Include error details trong logs (stack traces)

---

### 4. **Saturation** - Độ bão hòa

**Định nghĩa:** Mức độ "đầy" của resources (CPU, memory, disk, connections).

**Tại sao quan trọng:**
- Predict khi nào cần scale
- Phát hiện resource leaks
- Prevent outages trước khi xảy ra

**Metrics:**
```promql
# CPU saturation
1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m]))

# Memory saturation
1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)

# Disk saturation
1 - (node_filesystem_avail_bytes / node_filesystem_size_bytes)

# Connection pool saturation
mongodb_connections{conn_type="current"} 
/ 
(mongodb_connections{conn_type="current"} + mongodb_connections{conn_type="available"})
```

**Best practices:**
- ✅ Monitor utilization AND queuing (wait time)
- ✅ Alert trước khi đạt 100% (e.g., 80%)
- ✅ Track trends để capacity planning
- ✅ Include headroom cho traffic spikes

---

## 📈 SLI, SLO, SLA Framework

### SLI (Service Level Indicator)

**Định nghĩa:** Metric đo lường một aspect của service level.

**Examples:**
```
Request latency: p95 < 200ms
Availability: % successful requests
Throughput: requests/second
Data durability: % data not lost
```

**Trong hệ thống của bạn:**
```promql
# Availability SLI
sum(rate(http_requests_total{status!~"5.."}[5m])) 
/ 
sum(rate(http_requests_total[5m]))

# Latency SLI
histogram_quantile(0.95, 
  rate(http_request_duration_seconds_bucket[5m])
) < 0.2  # 200ms
```

---

### SLO (Service Level Objective)

**Định nghĩa:** Target value cho SLI.

**Format:** `[SLI] [comparison] [target] over [time window]`

**Examples:**
```
✅ 99.9% of requests succeed (availability)
✅ 95% of requests complete in < 200ms (latency)
✅ 99% of data writes are durable (durability)
```

**Error Budget:**
```
SLO = 99.9% uptime
Error budget = 100% - 99.9% = 0.1%

Monthly error budget:
30 days × 24 hours × 60 minutes × 0.1% = 43.2 minutes downtime/month
```

**Khi error budget cạn kiệt:**
- 🛑 Freeze feature releases
- 🔧 Focus 100% on reliability
- 📊 Post-mortem và fix root causes

---

### SLA (Service Level Agreement)

**Định nghĩa:** Contract với customers về service level, có consequences nếu vi phạm.

**Example:**
```
SLA: 99.95% uptime
Consequence: 
  - < 99.95%: 10% credit
  - < 99.9%: 25% credit
  - < 99%: 100% credit
```

**Relationship:**
```
SLA (99.95%) < SLO (99.9%) < Internal target (99.99%)
     ↑              ↑                    ↑
  Customer      Operational         Engineering
  commitment      target              goal
```

**Best practice:** SLO nên stricter hơn SLA để có buffer.

---

## 🎨 Monitoring Best Practices

### 1. **USE Method** (Brendan Gregg)

Cho **resources** (CPU, disk, network):

- **Utilization:** % time resource is busy
- **Saturation:** Degree of queued work
- **Errors:** Error count

**Example:**
```promql
# CPU
Utilization: avg(rate(node_cpu_seconds_total{mode!="idle"}[5m]))
Saturation: node_load1 / count(node_cpu_seconds_total{mode="idle"})
Errors: node_cpu_guest_seconds_total (context switches)

# Disk
Utilization: rate(node_disk_io_time_seconds_total[5m])
Saturation: rate(node_disk_io_time_weighted_seconds_total[5m])
Errors: rate(node_disk_read_errors_total[5m])
```

---

### 2. **RED Method** (Tom Wilkie)

Cho **services** (APIs, microservices):

- **Rate:** Requests per second
- **Errors:** Failed requests per second
- **Duration:** Request latency

**Example:**
```promql
# Rate
sum(rate(http_requests_total[5m])) by (endpoint)

# Errors
sum(rate(http_requests_total{status=~"5.."}[5m])) by (endpoint)

# Duration
histogram_quantile(0.95, 
  sum(rate(http_request_duration_seconds_bucket[5m])) by (le, endpoint)
)
```

---

### 3. **Cardinality Management**

**Problem:** High cardinality labels → memory explosion

**Bad:**
```promql
# user_id có hàng triệu values
http_requests_total{user_id="12345"}  ❌
```

**Good:**
```promql
# Chỉ dùng labels có bounded values
http_requests_total{endpoint="/api/users", status="200"}  ✅

# user_id trong log content, không phải label
{service="api"} | json | user_id="12345"  ✅
```

**Rules:**
- ✅ Labels: Low cardinality (< 1000 unique values)
- ✅ Log content: High cardinality data
- ✅ Avoid: timestamps, IDs, emails trong labels

---

### 4. **Alert Design**

**Principles:**

**1. Actionable**
```yaml
# Bad: Không biết làm gì
- alert: HighCPU
  expr: cpu > 80%
  
# Good: Rõ ràng action
- alert: HighCPUNeedScaling
  expr: cpu > 80%
  for: 15m
  annotations:
    summary: "CPU high for 15min, consider scaling"
    runbook: "https://wiki/runbooks/scale-cpu"
```

**2. Symptom-based, not cause-based**
```yaml
# Bad: Alert on cause
- alert: HighMemory
  expr: memory > 90%

# Good: Alert on symptom
- alert: SlowRequests
  expr: p95_latency > 500ms
  # Root cause có thể là memory, nhưng user care về latency
```

**3. Avoid alert fatigue**
```yaml
# Use "for" duration
for: 10m  # Chờ 10 phút confirm vấn đề thực sự

# Use severity levels
severity: warning  # Page on-call
severity: info     # Ticket only
```

**4. Include context**
```yaml
annotations:
  summary: "{{ $labels.instance }} high error rate"
  description: |
    Error rate: {{ $value }}%
    Threshold: 5%
    Affected service: {{ $labels.service }}
    Dashboard: https://grafana/d/xyz
    Runbook: https://wiki/runbooks/high-errors
```

---

### 5. **Dashboard Design**

**Hierarchy:**

```
Level 1: Overview Dashboard
  ├─ Golden Signals (Latency, Traffic, Errors, Saturation)
  ├─ SLI/SLO status
  └─ Top-level health indicators

Level 2: Service Dashboards
  ├─ Per-service metrics
  ├─ Dependencies
  └─ Resource usage

Level 3: Deep Dive Dashboards
  ├─ Database internals
  ├─ Cache performance
  └─ Network details
```

**Best practices:**
- ✅ Start with overview, drill down khi cần
- ✅ Use consistent color scheme (red = bad, green = good)
- ✅ Include links to runbooks
- ✅ Show trends (day-over-day, week-over-week)
- ✅ Avoid clutter: < 10 panels per dashboard

---

## 🔍 Evaluation Criteria

### 1. **Coverage** - Độ bao phủ

**Questions:**
- ✅ Có monitor tất cả critical services?
- ✅ Có monitor dependencies (databases, caches, queues)?
- ✅ Có monitor infrastructure (CPU, memory, disk, network)?
- ✅ Có collect logs từ tất cả components?

**Scoring:**
```
Excellent: 90-100% coverage
Good: 70-89%
Fair: 50-69%
Poor: < 50%
```

---

### 2. **Observability Maturity**

**Level 1: Reactive** ❌
- Chỉ biết có vấn đề khi users complain
- Không có metrics/logs
- Manual troubleshooting

**Level 2: Proactive** ⚠️
- Basic metrics (CPU, memory)
- Alerts on thresholds
- Logs available nhưng không structured

**Level 3: Predictive** ✅
- Comprehensive metrics (Golden Signals)
- SLI/SLO tracking
- Structured logs với correlation IDs
- Dashboards cho mọi service

**Level 4: Autonomous** 🚀
- Auto-remediation
- Anomaly detection (ML)
- Distributed tracing
- Full correlation: metrics ↔ traces ↔ logs

**Hệ thống của bạn:** Level 3-4 (có metrics, logs, traces via SigNoz)

---

### 3. **MTTD & MTTR**

**MTTD (Mean Time To Detect):**
- Thời gian từ khi incident xảy ra → phát hiện
- Target: < 5 minutes

**MTTR (Mean Time To Resolve):**
- Thời gian từ phát hiện → resolve
- Target: < 30 minutes (critical), < 4 hours (non-critical)

**Improvement strategies:**
- ✅ Better alerts → Reduce MTTD
- ✅ Runbooks → Reduce MTTR
- ✅ Auto-remediation → Reduce MTTR to seconds

---

### 4. **Alert Quality**

**Metrics:**

**Precision:**
```
Precision = True Positives / (True Positives + False Positives)

Target: > 90%
```

**Recall:**
```
Recall = True Positives / (True Positives + False Negatives)

Target: > 95%
```

**Alert Fatigue Index:**
```
Fatigue = Alerts per day / On-call engineers

Good: < 5 alerts/day/person
Bad: > 20 alerts/day/person
```

---

### 5. **Data Retention & Cost**

**Retention tiers:**

| Tier | Duration | Resolution | Use case |
|------|----------|------------|----------|
| **Raw** | 7-15 days | Full | Recent debugging |
| **Downsampled** | 30-90 days | 5min avg | Trend analysis |
| **Aggregated** | 1-2 years | 1hour avg | Long-term planning |

**Cost optimization:**
```
Loki (label-based): $10-50/TB/month
vs
Elasticsearch (full-text): $100-500/TB/month

Savings: 10-50x
```

---

## 📋 Checklist: Đánh giá Hệ thống Monitoring

### ✅ Metrics

- [ ] Collect Golden Signals (Latency, Traffic, Errors, Saturation)
- [ ] Track SLI/SLO cho critical services
- [ ] Use percentiles (p50, p95, p99), không chỉ averages
- [ ] Low cardinality labels (< 1000 unique values)
- [ ] Retention policy defined (15 days raw + downsampling)

### ✅ Logs

- [ ] Structured logging (JSON)
- [ ] Include correlation IDs (trace_id, request_id)
- [ ] Log levels consistent (DEBUG, INFO, WARN, ERROR)
- [ ] Sensitive data không log (passwords, tokens)
- [ ] Retention policy (7-30 days)

### ✅ Traces

- [ ] Distributed tracing enabled
- [ ] Sampling strategy defined (e.g., 10%)
- [ ] Trace context propagation (W3C Trace Context)
- [ ] Link traces ↔ logs via trace_id

### ✅ Alerts

- [ ] Symptom-based, không chỉ cause-based
- [ ] Actionable (có runbook)
- [ ] Avoid alert fatigue (< 5 alerts/day/person)
- [ ] Include context (dashboard links, affected resources)
- [ ] Test alerts regularly

### ✅ Dashboards

- [ ] Overview dashboard (Golden Signals)
- [ ] Per-service dashboards
- [ ] SLI/SLO tracking dashboard
- [ ] Consistent design (colors, layouts)
- [ ] Links to runbooks

### ✅ Operational

- [ ] On-call rotation defined
- [ ] Runbooks cho common incidents
- [ ] Post-mortem process
- [ ] Regular review của alerts (remove noise)
- [ ] Capacity planning based on trends

---

## 🎓 Áp dụng cho Hệ thống của bạn

### Hiện tại bạn có:

**✅ Strengths:**
- Comprehensive metrics (Prometheus)
- Structured logs (Loki + Promtail)
- Distributed tracing (SigNoz)
- Alert rules (Alertmanager → Telegram)
- Database monitoring (PostgreSQL, MongoDB exporters)
- Infrastructure monitoring (Node Exporter, cAdvisor)

**⚠️ Cần improve:**

1. **Define SLI/SLO:**
```yaml
# Example SLO
SLO:
  - name: API Availability
    target: 99.9%
    window: 30d
    
  - name: API Latency
    target: p95 < 200ms
    window: 30d
```

2. **Create runbooks:**
```markdown
# Runbook: High Error Rate

## Symptoms
- Error rate > 5%
- Alert: HighErrorRate firing

## Investigation
1. Check Grafana dashboard: [link]
2. View recent errors in Loki:
   {service="api", level="error"} [5m]
3. Check traces in SigNoz for failed requests

## Common causes
- Database connection pool exhausted
- External API timeout
- Deployment issue

## Resolution
- Scale database connections
- Rollback deployment
- Contact external API provider
```

3. **Implement error budget tracking:**
```promql
# Error budget remaining
(1 - (
  sum(rate(http_requests_total{status=~"5.."}[30d])) 
  / 
  sum(rate(http_requests_total[30d]))
)) - 0.999  # SLO = 99.9%
```

4. **Add business metrics:**
```promql
# Orders per minute
rate(orders_total[5m])

# Revenue per hour
sum(rate(order_revenue_total[1h]))

# User signups
rate(user_signups_total[5m])
```

---

## 📚 Resources

**Books:**
- "Site Reliability Engineering" - Google
- "The Site Reliability Workbook" - Google
- "Observability Engineering" - Charity Majors

**Links:**
- [Google SRE Book](https://sre.google/sre-book/table-of-contents/)
- [Prometheus Best Practices](https://prometheus.io/docs/practices/)
- [Grafana Loki Best Practices](https://grafana.com/docs/loki/latest/best-practices/)

---

## 🎯 Summary

**Key Takeaways:**

1. **Monitor Golden Signals:** Latency, Traffic, Errors, Saturation
2. **Define SLI/SLO:** Measure what matters to users
3. **Alert on symptoms:** Not causes
4. **Reduce MTTD & MTTR:** Faster detection & resolution
5. **Avoid alert fatigue:** Quality over quantity
6. **Correlation is key:** Metrics ↔ Traces ↔ Logs
7. **Continuous improvement:** Review và optimize regularly

**Your monitoring stack is solid!** Focus on:
- Defining SLI/SLO
- Creating runbooks
- Tracking error budgets
- Adding business metrics
