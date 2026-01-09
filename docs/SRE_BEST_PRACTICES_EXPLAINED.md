# SRE Best Practices - Giải thích Chi tiết

## 📖 Mục đích tài liệu

Tài liệu này giải thích **TẠI SAO** và **LÀM THẾ NÀO** áp dụng các SRE best practices, không chỉ liệt kê. Mỗi practice đi kèm với:
- ✅ Giải thích tại sao quan trọng
- 🎯 Ví dụ thực tế
- 🛠️ Cách implement
- ⚠️ Pitfalls cần tránh

---

## 1. The Four Golden Signals - Giải thích Thực tế

### Tại sao chỉ 4 signals?

Google SRE team phát hiện rằng **80% vấn đề** có thể phát hiện qua 4 metrics này. Thay vì monitor hàng trăm metrics, focus vào 4 cái quan trọng nhất.

### 1.1 Latency - Hiểu Sâu

**Câu chuyện thực tế:**

```
Scenario: E-commerce website
- Average latency: 100ms ✅ Looks good!
- Nhưng users vẫn complain "trang chậm"

Vấn đề: Average bị skew bởi majority fast requests
Reality:
  - p50 (median): 50ms    ← 50% users OK
  - p95: 500ms            ← 5% users chậm
  - p99: 2000ms           ← 1% users RẤT chậm
  
Impact: 1% = 10,000 users/day nếu có 1M users
```

**Lesson:** Đừng chỉ nhìn average. Track percentiles!

**Implementation:**

```promql
# BAD: Average latency
avg(http_request_duration_seconds)

# GOOD: Percentiles
histogram_quantile(0.50, rate(http_request_duration_seconds_bucket[5m]))  # p50
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))  # p95
histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))  # p99
```

**Tại sao phân biệt successful vs failed requests?**

```
Scenario: API timeout sau 30s
- Failed requests: 30s latency (timeout)
- Successful requests: 100ms latency

Nếu mix cả 2:
  Average = (100ms × 99 + 30000ms × 1) / 100 = 400ms
  
Misleading! Successful requests vẫn nhanh, nhưng có 1% timeout.
```

**Best practice:**

```promql
# Latency của successful requests only
histogram_quantile(0.95, 
  rate(http_request_duration_seconds_bucket{status!~"5.."}[5m])
)

# Latency của failed requests separately
histogram_quantile(0.95, 
  rate(http_request_duration_seconds_bucket{status=~"5.."}[5m])
)
```

---

### 1.2 Traffic - Tại sao cần monitor?

**Câu chuyện thực tế:**

```
Scenario: Black Friday sale
- Normal traffic: 1000 req/s
- Black Friday: 50,000 req/s (50x increase)

Không monitor traffic:
  ❌ Servers crash vì không scale kịp
  ❌ Database connection pool exhausted
  ❌ Mất revenue vì downtime

Có monitor traffic:
  ✅ Alert khi traffic > 10,000 req/s
  ✅ Auto-scale thêm servers
  ✅ Pre-warm caches
  ✅ Increase connection pools
```

**Pattern Recognition:**

```promql
# Daily pattern
rate(http_requests_total[5m])

Typical pattern:
  00:00-06:00: 100 req/s   (night)
  06:00-09:00: 500 req/s   (morning rush)
  09:00-18:00: 1000 req/s  (work hours)
  18:00-22:00: 800 req/s   (evening)
  22:00-00:00: 200 req/s   (late night)
```

**Anomaly Detection:**

```promql
# Alert nếu traffic tăng đột ngột > 50%
(
  rate(http_requests_total[5m])
  /
  rate(http_requests_total[5m] offset 1h)
) > 1.5
```

**Giải thích:**
- `rate(...[5m])`: Traffic hiện tại
- `rate(...[5m] offset 1h)`: Traffic 1 giờ trước
- Ratio > 1.5 = tăng 50%

**Use cases:**
- DDoS attack detection
- Marketing campaign impact
- Viral content spike
- Bot traffic

---

### 1.3 Errors - Tại sao Error Rate quan trọng hơn Error Count?

**Ví dụ thực tế:**

```
Scenario 1: Low traffic
- 10 requests/minute
- 1 error/minute
- Error count: 1 ❌ Looks OK
- Error rate: 10% ⚠️ VERY BAD!

Scenario 2: High traffic
- 10,000 requests/minute
- 100 errors/minute
- Error count: 100 ❌ Looks BAD
- Error rate: 1% ✅ Acceptable

Lesson: Error rate cho context, error count không
```

**Implementation:**

```promql
# Error rate (percentage)
(
  rate(http_requests_total{status=~"5.."}[5m])
  /
  rate(http_requests_total[5m])
) * 100

# Alert rule
- alert: HighErrorRate
  expr: |
    (
      rate(http_requests_total{status=~"5.."}[5m])
      /
      rate(http_requests_total[5m])
    ) > 0.01  # 1%
  for: 5m
  annotations:
    summary: "Error rate > 1% for 5 minutes"
```

**Phân loại Errors:**

```
4xx Errors (Client errors):
  - 400 Bad Request: Client gửi invalid data
  - 401 Unauthorized: Authentication failed
  - 404 Not Found: Resource không tồn tại
  
  → Thường KHÔNG phải lỗi hệ thống
  → Có thể do user error hoặc bot
  → Alert nếu spike đột ngột (có thể là attack)

5xx Errors (Server errors):
  - 500 Internal Server Error: Bug trong code
  - 502 Bad Gateway: Upstream service down
  - 503 Service Unavailable: Overloaded
  
  → LÀ lỗi hệ thống
  → CẦN alert và fix ngay
  → Ảnh hưởng SLA
```

**Best practice:**

```promql
# Track separately
4xx_rate = rate(http_requests_total{status=~"4.."}[5m]) / rate(http_requests_total[5m])
5xx_rate = rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])

# Alert chỉ trên 5xx
- alert: ServerErrors
  expr: 5xx_rate > 0.01
```

---

### 1.4 Saturation - Predict Trước Khi Quá Muộn

**Câu chuyện thực tế:**

```
Scenario: Database connection pool
- Max connections: 100
- Current: 95
- Utilization: 95% ⚠️

Không monitor saturation:
  ❌ Request thứ 101 → wait
  ❌ Request thứ 102 → wait
  ❌ Queue builds up
  ❌ Timeouts cascade
  ❌ Total outage

Có monitor saturation:
  ✅ Alert at 80% (còn buffer 20 connections)
  ✅ Scale database hoặc increase pool
  ✅ Prevent outage
```

**Metrics cho Saturation:**

```promql
# Connection pool saturation
mongodb_connections{conn_type="current"} 
/ 
(mongodb_connections{conn_type="current"} + mongodb_connections{conn_type="available"})

Interpretation:
  < 0.5 (50%): Healthy
  0.5-0.7 (50-70%): Normal load
  0.7-0.9 (70-90%): High load, monitor closely
  > 0.9 (90%): CRITICAL, scale now!
```

**CPU Saturation - Không chỉ là Utilization:**

```
CPU Utilization: % time CPU is busy
  - 80% CPU → Có thể OK nếu không có queuing

CPU Saturation: Work waiting in queue
  - Load average > CPU cores → Có work đang chờ
  
Example:
  4-core machine
  Load average: 8.0
  → 4 cores đang chạy, 4 tasks đang chờ
  → Saturation = 100%
```

```promql
# CPU saturation
node_load1 / count(node_cpu_seconds_total{mode="idle"})

Interpretation:
  < 1.0: No saturation
  1.0-2.0: Some queuing
  > 2.0: Significant queuing, scale!
```

**Disk Saturation:**

```promql
# Disk space saturation
1 - (node_filesystem_avail_bytes / node_filesystem_size_bytes)

# Alert at 80%, not 95%!
- alert: DiskSpaceLow
  expr: |
    1 - (node_filesystem_avail_bytes / node_filesystem_size_bytes) > 0.8
  for: 15m
  annotations:
    summary: "Disk {{ $labels.device }} is 80% full"
    description: "Only {{ $value | humanizePercentage }} space remaining"
```

**Tại sao alert ở 80%, không phải 95%?**

```
Scenario: Log files growing
- Disk: 1TB
- Current: 800GB (80%)
- Growth rate: 50GB/day

At 80% alert:
  → 200GB remaining
  → 4 days to full
  → Time to cleanup or expand

At 95% alert:
  → 50GB remaining
  → 1 day to full
  → PANIC MODE!
```

---

## 2. SLI/SLO/SLA - Giải thích Thực tế

### Tại sao cần SLI/SLO?

**Vấn đề không có SLO:**

```
PM: "Hệ thống có ổn định không?"
Dev: "Ổn định"
PM: "Ổn định là sao?"
Dev: "Ừ... không có downtime nhiều"
PM: "Nhiều là bao nhiêu?"
Dev: "..."

→ Không có tiêu chuẩn rõ ràng
→ Không biết khi nào cần improve
→ Không có data để justify resources
```

**Với SLO:**

```
SLO: 99.9% uptime = 43.2 minutes downtime/month

Month 1: 99.95% uptime (21.6 min downtime) ✅ Beat SLO
Month 2: 99.85% uptime (64.8 min downtime) ❌ Miss SLO

Action: Post-mortem, fix root causes, improve
```

### SLI Examples - Thực tế

**1. Availability SLI:**

```promql
# Definition
availability = successful_requests / total_requests

# Implementation
sum(rate(http_requests_total{status!~"5.."}[30d]))
/
sum(rate(http_requests_total[30d]))

# Example values
0.999 = 99.9% = 43.2 min downtime/month
0.9999 = 99.99% = 4.32 min downtime/month
0.99999 = 99.999% = 26 seconds downtime/month
```

**Tại sao 30 days window?**

```
Short window (1 hour):
  - Spike trong 1 giờ → SLI drop dramatically
  - Không reflect overall reliability
  
Long window (30 days):
  - Smooth out short-term issues
  - Reflect user experience over time
  - Align với monthly SLA
```

**2. Latency SLI:**

```promql
# Definition
latency_sli = percentage of requests < threshold

# Implementation
sum(rate(http_request_duration_seconds_bucket{le="0.2"}[30d]))
/
sum(rate(http_request_duration_seconds_count[30d]))

# Interpretation
0.95 = 95% of requests < 200ms
```

**Tại sao p95, không phải p99?**

```
p95: 95% users có experience tốt
  - 5% users = 50,000 users/day (nếu 1M users)
  - Đủ lớn để care
  - Achievable target

p99: 99% users có experience tốt
  - 1% users = 10,000 users/day
  - Harder to achieve
  - Expensive to optimize (long tail)
  
Balance: p95 cho most users, p99 cho critical paths
```

### Error Budget - Giải thích Thực tế

**Concept:**

```
SLO = 99.9% uptime
Error budget = 100% - 99.9% = 0.1%

Monthly error budget:
  30 days × 24 hours × 60 minutes = 43,200 minutes
  43,200 × 0.1% = 43.2 minutes downtime allowed
```

**Tại sao Error Budget quan trọng?**

**Scenario 1: Không có Error Budget**

```
Dev team: "Chúng ta deploy feature mới nhé"
Ops team: "Không, rủi ro quá"
Dev team: "Nhưng customers cần feature này"
Ops team: "Nhưng stability..."

→ Conflict giữa innovation và stability
→ Không có data để quyết định
```

**Scenario 2: Có Error Budget**

```
Current error budget: 30 minutes remaining (70% used)

Dev team: "Deploy feature mới?"
Ops team: "Check error budget... còn 30 minutes"
Decision: 
  - If feature critical: Deploy, accept risk
  - If feature nice-to-have: Wait until next month
  
→ Data-driven decision
→ Balance innovation và stability
```

**Error Budget Policy:**

```yaml
Error Budget Status: Actions

> 50% remaining:
  ✅ Normal velocity
  ✅ Deploy new features
  ✅ Experiments OK

10-50% remaining:
  ⚠️ Slow down deployments
  ⚠️ Focus on reliability
  ⚠️ No risky experiments

< 10% remaining:
  🛑 FREEZE deployments
  🛑 Only critical fixes
  🛑 All hands on reliability
  🛑 Post-mortem required

0% (exhausted):
  🚨 INCIDENT
  🚨 Immediate action
  🚨 Executive escalation
```

**Tracking Error Budget:**

```promql
# Error budget remaining (percentage)
error_budget_remaining = (
  1 - (
    sum(rate(http_requests_total{status=~"5.."}[30d]))
    /
    sum(rate(http_requests_total[30d]))
  )
) - slo_target

# Example
SLO = 0.999 (99.9%)
Current availability = 0.9985 (99.85%)

Error budget used:
  (1 - 0.9985) - (1 - 0.999) = 0.0015 - 0.001 = 0.0005
  = 0.05% of error budget used
  = 50% of allowed errors

Error budget remaining: 50%
```

---

## 3. Alert Design - Thực tế

### Vấn đề Alert Fatigue

**Câu chuyện thực tế:**

```
Week 1: 50 alerts/day
  → On-call engineer checks mỗi alert
  → 45 alerts false positive
  → 5 alerts thật

Week 2: 50 alerts/day
  → Engineer bắt đầu ignore
  → Miss 1 critical alert
  → Outage 2 hours

Week 3: 50 alerts/day
  → Engineer mute alerts
  → Miss major incident
  → Outage 6 hours

Lesson: Too many alerts = No alerts
```

**Solution: Alert Quality over Quantity**

```yaml
# BAD: Alert on everything
- alert: HighCPU
  expr: cpu > 50%  # Fires constantly
  
- alert: AnyError
  expr: errors > 0  # Always firing

# GOOD: Alert on symptoms that matter
- alert: SlowUserExperience
  expr: p95_latency > 500ms
  for: 10m  # Confirm it's real
  annotations:
    summary: "Users experiencing slow response"
    impact: "Affects checkout flow"
    runbook: "https://wiki/runbooks/slow-response"
```

### Actionable Alerts

**BAD Alert:**

```yaml
- alert: HighMemory
  expr: memory > 90%
  annotations:
    summary: "Memory is high"
```

**Vấn đề:**
- Không biết làm gì
- Không biết impact
- Không biết urgent hay không

**GOOD Alert:**

```yaml
- alert: MemoryLeakDetected
  expr: |
    (
      node_memory_MemAvailable_bytes
      /
      node_memory_MemTotal_bytes
    ) < 0.1
  for: 15m
  labels:
    severity: critical
    component: infrastructure
  annotations:
    summary: "{{ $labels.instance }} memory critically low"
    description: |
      Memory available: {{ $value | humanizePercentage }}
      
      Impact:
        - OOM killer may start
        - Application crashes possible
        - User requests will fail
      
      Immediate actions:
        1. Check for memory leaks: kubectl top pods
        2. Restart leaking pods
        3. Scale up if needed
      
      Runbook: https://wiki/runbooks/memory-leak
      Dashboard: https://grafana/d/memory
      Slack: #oncall-critical
```

**Tại sao tốt hơn:**
- ✅ Rõ ràng severity (critical)
- ✅ Explain impact (OOM, crashes)
- ✅ Actionable steps (check, restart, scale)
- ✅ Links to resources (runbook, dashboard)

### Symptom vs Cause Based Alerts

**Concept:**

```
Cause: Nguyên nhân (CPU high, memory high, disk full)
Symptom: Triệu chứng (slow response, errors, timeouts)

Users care về symptoms, không phải causes
```

**Example:**

```yaml
# BAD: Cause-based
- alert: HighCPU
  expr: cpu > 80%
  # Vấn đề: CPU 80% có thể OK nếu requests vẫn nhanh

# GOOD: Symptom-based
- alert: SlowRequests
  expr: p95_latency > 500ms
  # Users care về latency, không phải CPU
  # Root cause có thể là CPU, memory, network, database...
```

**Workflow:**

```
1. Symptom alert fires: "SlowRequests"
   → On-call investigates
   
2. Check potential causes:
   - CPU high? → Scale up
   - Memory high? → Fix leak
   - Database slow? → Optimize queries
   - Network issue? → Check connectivity
   
3. Fix root cause
   → Symptom resolves
```

**Benefit:**
- Focus on user impact
- Avoid false positives (high CPU nhưng latency OK)
- Flexible (nhiều causes có thể gây cùng symptom)

---

## 4. Dashboard Design - Thực tế

### Hierarchy Approach

**Level 1: Overview Dashboard (Glance trong 5 giây)**

```
Purpose: "Hệ thống có OK không?"

Panels:
  1. Traffic (requests/s) - Trending up/down?
  2. Error rate (%) - Trong threshold?
  3. Latency (p95) - Users happy?
  4. Saturation (CPU, memory, disk) - Need to scale?
  
Color coding:
  Green: All good
  Yellow: Warning
  Red: Critical

Example:
  ┌─────────────────────────────────────┐
  │ System Health: ✅ HEALTHY           │
  ├─────────────────────────────────────┤
  │ Traffic:      1,234 req/s  ✅       │
  │ Error Rate:   0.5%         ✅       │
  │ Latency p95:  150ms        ✅       │
  │ CPU:          65%          ✅       │
  │ Memory:       72%          ✅       │
  └─────────────────────────────────────┘
```

**Level 2: Service Dashboard (Drill down khi có vấn đề)**

```
Purpose: "Service nào có vấn đề?"

Panels per service:
  1. Request rate by endpoint
  2. Error rate by endpoint
  3. Latency distribution (p50, p95, p99)
  4. Dependencies status
  5. Resource usage

Example:
  API Service Dashboard
  ┌─────────────────────────────────────┐
  │ /api/users:     500 req/s  ✅       │
  │ /api/orders:    300 req/s  ⚠️ slow │
  │ /api/products:  200 req/s  ✅       │
  ├─────────────────────────────────────┤
  │ Dependencies:                        │
  │   PostgreSQL:   ✅ Healthy          │
  │   Redis:        ⚠️ High latency     │
  │   Payment API:  ✅ Healthy          │
  └─────────────────────────────────────┘
```

**Level 3: Deep Dive (Debug specific issue)**

```
Purpose: "Tại sao /api/orders chậm?"

Panels:
  1. Query breakdown (which queries slow?)
  2. Database connection pool
  3. Cache hit ratio
  4. External API calls
  5. Slow query logs

Example:
  /api/orders Deep Dive
  ┌─────────────────────────────────────┐
  │ Slow queries:                        │
  │   SELECT * FROM orders WHERE...     │
  │   Duration: 2.5s ❌                 │
  │   Execution count: 1,234/min        │
  │                                      │
  │ Root cause: Missing index on        │
  │   orders.user_id                    │
  │                                      │
  │ Action: CREATE INDEX idx_user_id    │
  └─────────────────────────────────────┘
```

### Dashboard Anti-Patterns

**❌ Too Many Panels:**

```
Dashboard với 50 panels:
  - Overwhelming
  - Không biết nhìn cái nào
  - Slow to load
  
Better: < 10 panels per dashboard
```

**❌ No Context:**

```
Panel: "CPU Usage"
  - CPU của cái gì?
  - Threshold là bao nhiêu?
  - High CPU có OK không?
  
Better: "API Server CPU (target < 70%)"
```

**❌ No Time Context:**

```
Panel chỉ show current value:
  CPU: 85%
  
  - Đang tăng hay giảm?
  - Spike hay sustained?
  - Compare với yesterday?
  
Better: Show trend (last 24h, last 7d)
```

---

## 5. Observability Maturity - Journey

### Level 1: Reactive (Firefighting)

**Characteristics:**
```
- Biết có vấn đề khi users complain
- Không có metrics
- Logs scattered, không structured
- Debug bằng SSH vào server
- "Works on my machine"
```

**Example incident:**

```
10:00 AM: Users report "website down"
10:05 AM: Team starts investigating
10:30 AM: Still don't know what's wrong
11:00 AM: Try restarting everything
11:30 AM: Still down
12:00 PM: Call vendor support
14:00 PM: Finally fixed (database ran out of disk)

MTTD: 5 minutes (user reported)
MTTR: 4 hours
Total downtime: 4 hours
```

**Cost:**
- Lost revenue: 4 hours × $10,000/hour = $40,000
- Customer trust: Priceless
- Team stress: High

---

### Level 2: Proactive (Basic Monitoring)

**Characteristics:**
```
- Basic metrics (CPU, memory, disk)
- Simple alerts (disk > 90%)
- Logs collected centrally
- Some dashboards
```

**Same incident with Level 2:**

```
09:45 AM: Alert fires "Disk > 90%"
09:50 AM: On-call checks, sees database disk full
09:55 AM: Cleanup old logs
10:00 AM: Back to normal

MTTD: 15 minutes (before users notice)
MTTR: 15 minutes
Total downtime: 0 (prevented)
```

**Improvement:**
- Prevented outage
- Saved $40,000
- Happy customers
- Less stress

---

### Level 3: Predictive (Advanced Monitoring)

**Characteristics:**
```
- Comprehensive metrics (Golden Signals)
- SLI/SLO tracking
- Structured logs với correlation
- Distributed tracing
- Capacity planning
```

**Same scenario with Level 3:**

```
Monday: Dashboard shows disk usage trending
  - Current: 70%
  - Growth rate: 5%/day
  - Prediction: 90% in 4 days (Friday)

Tuesday: Create ticket "Increase disk or cleanup"
Wednesday: Implement log rotation
Thursday: Disk usage drops to 60%
Friday: No incident

MTTD: 4 days before problem
MTTR: N/A (prevented)
Total downtime: 0
```

**Improvement:**
- Predicted problem before it happened
- Planned fix during business hours
- No stress, no rush
- Proactive, not reactive

---

### Level 4: Autonomous (Self-Healing)

**Characteristics:**
```
- Auto-scaling
- Auto-remediation
- Anomaly detection (ML)
- Chaos engineering
- Full automation
```

**Same scenario with Level 4:**

```
System detects disk growth pattern
→ Auto-triggers cleanup job
→ Removes old logs
→ Disk usage stays at 60%
→ No human intervention

MTTD: Real-time
MTTR: Automatic
Total downtime: 0
Human effort: 0
```

---

## 6. Practical Implementation Guide

### Step 1: Start with Golden Signals

**Week 1: Implement Latency tracking**

```promql
# Add to your application
histogram_quantile(0.95, 
  rate(http_request_duration_seconds_bucket[5m])
)

# Create dashboard panel
# Create alert if p95 > 500ms
```

**Week 2: Add Traffic monitoring**

```promql
rate(http_requests_total[5m])

# Create dashboard
# Create alert for sudden changes
```

**Week 3: Track Errors**

```promql
rate(http_requests_total{status=~"5.."}[5m])
/
rate(http_requests_total[5m])

# Alert if > 1%
```

**Week 4: Monitor Saturation**

```promql
# CPU, memory, disk, connections
# Alert at 80%, not 95%
```

### Step 2: Define SLO

**Month 2: Baseline**

```
Collect data for 30 days:
  - What's current availability?
  - What's current latency?
  - What's acceptable?
```

**Month 3: Set SLO**

```yaml
SLO:
  - Availability: 99.9%
  - Latency: p95 < 200ms
  - Error rate: < 1%
```

**Month 4: Track Error Budget**

```
Monitor monthly:
  - Error budget used
  - Error budget remaining
  - Adjust velocity accordingly
```

### Step 3: Improve Alerts

**Month 5: Audit Alerts**

```
For each alert:
  - Is it actionable?
  - Is it symptom-based?
  - Does it have runbook?
  - Is severity correct?
  
Remove/fix bad alerts
```

**Month 6: Add Context**

```yaml
# Update all alerts with:
annotations:
  summary: Clear description
  impact: User impact
  runbook: Link to runbook
  dashboard: Link to dashboard
```

### Step 4: Build Dashboards

**Month 7: Overview Dashboard**

```
Single dashboard showing:
  - Golden Signals
  - SLO status
  - Error budget
  - Top issues
```

**Month 8: Service Dashboards**

```
One dashboard per service:
  - Service-specific metrics
  - Dependencies
  - Resource usage
```

### Step 5: Continuous Improvement

**Ongoing:**

```
Weekly:
  - Review alerts (any false positives?)
  - Check SLO status
  - Update runbooks

Monthly:
  - Review error budget
  - Capacity planning
  - Update SLO if needed

Quarterly:
  - Post-mortems review
  - Process improvements
  - Training
```

---

## 7. Common Pitfalls & Solutions

### Pitfall 1: "We monitor everything!"

**Problem:**
```
1000 metrics collected
100 dashboards created
500 alerts configured

Result:
  - Nobody knows what to look at
  - Alert fatigue
  - High costs
  - Low value
```

**Solution:**
```
Start with Golden Signals (4 metrics)
Add more only when needed
Remove unused metrics/dashboards/alerts
```

### Pitfall 2: "Average is good enough"

**Problem:**
```
Average latency: 100ms ✅

Reality:
  - 90% requests: 50ms
  - 9% requests: 200ms
  - 1% requests: 5000ms (timeout)

Users complain but metrics look good
```

**Solution:**
```
Always use percentiles (p50, p95, p99)
Never rely on average alone
```

### Pitfall 3: "Alert on everything"

**Problem:**
```
Alert when:
  - CPU > 50%
  - Memory > 60%
  - Disk > 70%
  - Any error occurs
  - Traffic changes

Result: 100 alerts/day, all ignored
```

**Solution:**
```
Alert only on:
  - User-impacting symptoms
  - SLO violations
  - Imminent disasters (disk 90%)

Target: < 5 alerts/day
```

### Pitfall 4: "No runbooks"

**Problem:**
```
Alert fires at 3 AM
On-call wakes up
Doesn't know what to do
Escalates to senior
Senior also doesn't remember
Spend 2 hours figuring out
```

**Solution:**
```
Every alert must have runbook:
  1. What's happening?
  2. Why does it matter?
  3. How to investigate?
  4. How to fix?
  5. Who to escalate to?
```

---

## 8. Success Metrics

### How to measure if your monitoring is good?

**1. MTTD (Mean Time To Detect)**

```
Target: < 5 minutes

Measure:
  - Time from incident start to alert
  - Track monthly average
  - Trend should go down
```

**2. MTTR (Mean Time To Resolve)**

```
Target: < 30 minutes (critical)

Measure:
  - Time from alert to resolution
  - Track per incident type
  - Identify patterns
```

**3. Alert Quality**

```
Precision = True Positives / (True Positives + False Positives)
Target: > 90%

Track:
  - How many alerts were real issues?
  - How many were false alarms?
```

**4. SLO Compliance**

```
Target: Meet SLO 95% of months

Track:
  - Monthly SLO achievement
  - Error budget usage
  - Trend over time
```

**5. Incident Reduction**

```
Target: 50% reduction year-over-year

Track:
  - Number of incidents/month
  - Severity distribution
  - Repeat incidents (should decrease)
```

---

## 🎯 Summary

**Key Principles:**

1. **Start Simple**: Golden Signals first, complexity later
2. **User Focus**: Monitor symptoms, not just causes
3. **Data-Driven**: SLO/error budget guide decisions
4. **Actionable**: Every alert needs clear action
5. **Continuous**: Always improving, never done

**Your Next Steps:**

1. ✅ Implement Golden Signals (Week 1-4)
2. ✅ Define SLO (Month 2-3)
3. ✅ Improve alerts (Month 5-6)
4. ✅ Build dashboards (Month 7-8)
5. ✅ Continuous improvement (Ongoing)

**Remember:**
- Perfect is enemy of good
- Start small, iterate
- Measure, learn, improve
- Focus on user impact

Good luck! 🚀
