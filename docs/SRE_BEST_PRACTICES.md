# SRE Best Practices & Monitoring Standards for LGTM Stack

## 📊 Tổng quan

Tài liệu này định nghĩa các tiêu chuẩn giám sát (Monitoring Standards) và phương pháp đánh giá độ tin cậy (Reliability Evaluation) cho hệ thống sử dụng **LGTM Stack (Loki, Grafana, Tempo, Mimir)** và **Grafana Alloy**.

Nó kết hợp các lý thuyết SRE chuẩn mực của Google với các hướng dẫn thực hành chi tiết, giải thích **TẠI SAO** cần làm vậy và làm **NHƯ THẾ NÀO**.

---

## 🎯 1. The Four Golden Signals (Google SRE)

Chúng tôi sử dụng 4 tín hiệu vàng làm kim chỉ nam cho việc giám sát mọi service trong hệ thống. Google SRE team phát hiện rằng **80% vấn đề** có thể phát hiện qua 4 metrics này.

### 1.1. Latency - Độ trễ
*   **Định nghĩa:** Thời gian để xử lý một request (tính từ khi nhận đến khi phản hồi).
*   **Metrics (PromQL):**
    ```promql
    # P95 Latency - 95% requests nhanh hơn ngưỡng này
    histogram_quantile(0.95, sum(rate(traces_spanmetrics_latency_bucket[5m])) by (le, service_name))
    ```

#### 💡 Deep Dive: Tại sao không dùng Average?
**Scenario thực tế:**
*   Average latency: 100ms ✅ (Trông có vẻ ổn).
*   Nhưng users vẫn kêu chậm!
*   **Lý do**: Average bị "kéo" xuống bởi hàng ngàn requests siêu nhanh (cache hit). Trong khi đó, 5% users bị timeout (30s).
*   **Giải pháp**: Monitor **Percentiles**.
    *   **P50 (Median)**: Trải nghiệm của đa số users.
    *   **P95**: Trải nghiệm của users khi hệ thống tải cao.
    *   **P99**: Các case chậm nhất (thường là lỗi).

### 1.2. Traffic - Lưu lượng
*   **Định nghĩa:** Nhu cầu sử dụng hệ thống (Requests/sec, Transactions/sec).
*   **Metrics (PromQL):**
    ```promql
    # Request per second (RPS)
    sum(rate(traces_spanmetrics_calls_total[1m])) by (service_name)
    ```

#### 💡 Deep Dive: Pattern Recognition
Traffic thường tuân theo quy luật (Ngày/Đêm, Cuối tuần).
*   **Tại sao cần monitor?**: Để phát hiện bất thường (Anomaly).
*   **Ví dụ**: Traffic lúc 3h sáng đột ngột tăng gấp 10 lần -> Có thể là **DDoS** hoặc **Crawl Bot**.
*   **Action**: Alert nếu traffic tăng đột biến > 50% so với cùng kỳ tuần trước (`offset 1w`).

### 1.3. Errors - Lỗi
*   **Định nghĩa:** Tỷ lệ requests thất bại (5xx codes, exceptions).
*   **Metrics (PromQL & LogQL):**
    ```promql
    # Error Rate %
    sum(rate(traces_spanmetrics_calls_total{status_code="STATUS_CODE_ERROR"}[5m])) / sum(rate(traces_spanmetrics_calls_total[5m]))
    ```

#### 💡 Deep Dive: 4xx vs 5xx
*   **4xx (Client Error)**: User nhập sai, Unauthorized. Thường không phải lỗi hệ thống (trừ khi spike đột biến do tấn công).
*   **5xx (Server Error)**: Bug code, DB chết, Timeout. **ĐÂY** là lỗi cần đánh thức Dev dậy lúc 2h sáng.
*   **Rule**: Chỉ Alert P1/P2 cho lỗi 5xx.

### 1.4. Saturation - Độ bão hòa
*   **Định nghĩa:** Mức độ "đầy" của tài nguyên (Full CPU, Full Disk, Full Connection Pool).
*   **Metrics (PromQL):**
    ```promql
    # Prediction: Disk sẽ đầy trong 24h tới?
    predict_linear(node_filesystem_free_bytes[1h], 24*3600) < 0
    ```

#### 💡 Deep Dive: Predict trước khi quá muộn
Đừng đợi disk 100% mới báo. Hãy báo khi **"với tốc độ này, 4 tiếng nữa sẽ đầy"**.
*   **Benefit**: Có thời gian để clean logs hoặc resize volume mà không gây downtime.

---

## 📈 2. SLI, SLO & Error Budgets

Đây là công cụ để cân bằng giữa **Innovation** (Feature mới) và **Stability** (Ổn định).

### Service Level Objective (SLO)
Là cam kết độ tin cậy. Ví dụ: "99.9% requests thành công".

### Error Budget (Ngân sách lỗi)
Nếu SLO là 99.9% => Chúng ta được phép lỗi **0.1%**.
*   Trong 1 tháng (43,200 phút), 0.1% tương đương **43 phút**.
*   Đây là "ngân sách" để tiêu xài cho việc deploy, thử nghiệm.

#### 💡 Quy tắc Error Budget
1.  **Còn nhiều Budget (>50%)**: Team được phép deploy thoải mái, thử nghiệm công nghệ mới.
2.  **Hết Budget (0%)**: **FREEZE**. Ngưng toàn bộ feature deploy. Toàn team tập trung sửa lỗi và cải thiện độ ổn định cho đến khi sang tháng mới (reset budget).

---

## 🎨 3. Dashboard Design Standards

### Hierarchy Approach (Phân cấp)

**Level 1: Overview (Glance trong 5 giây)**
*   **Mục đích**: Sếp hoặc Operator nhìn vào biết ngay hệ thống Sống hay Chết.
*   **Nội dung**: 4 Golden Signals của toàn hệ thống (Traffic tổng, Error rate tổng). Màu Xanh/Đỏ rõ ràng.

**Level 2: Service Dashboard (Drill down)**
*   **Mục đích**: Dev tìm lỗi của Service mình.
*   **Nội dung**: Chi tiết từng API, latency từng endpoint, dependencies (Redis/DB) của service đó.

**Level 3: Deep Dive (Debug)**
*   **Mục đích**: Database Administrator (DBA) debug.
*   **Nội dung**: Slow query logs, Buffer pool hit ratio, Lock wait time.

### Anti-Patterns (Cần tránh)
*   ❌ **Too Many Panels**: Dashboard có 50 biểu đồ => Không ai xem. Tối đa 10-12 panels "đắt giá" nhất.
*   ❌ **No Context**: Biểu đồ CPU cao 80% nhưng không biết bình thường là bao nhiêu. Cần vẽ thêm đường Threshold (ngưỡng) trên biểu đồ.

---

## 🛡️ 4. Observability Maturity Model

Hệ thống hiện tại đang ở **Level 3 (Predictive)** nhờ LGTM Stack.

| Level | Đặc điểm | Ví dụ thực tế |
|-------|----------|---------------|
| **1. Reactive** | Chữa cháy | User báo "Web sập rồi" mới biết. Team nháo nhào log vào server check. |
| **2. Proactive** | Phòng ngừa | Có Alert "Disk > 90%". Team vào dọn dẹp trước khi sập. |
| **3. Predictive** | Dự báo | Alert "Disk sẽ đầy trong 3 ngày nữa". Team có kế hoạch nâng cấp thong thả. (LGTM Stack đang ở đây) |
| **4. Autonomous** | Tự hành | Hệ thống thấy traffic tăng -> Tự gọi API cloud tạo thêm server. Thấy Disk đầy -> Tự chạy script xóa log cũ. |

---

## ✅ 5. Practical Implementation Guide (Lộ trình cho SRE)

Dưới đây là checklist để nâng cấp hệ thống monitoring của bạn theo từng tuần:

**Tuần 1: Implement Golden Signals**
- [ ] Gắn thư viện metrics (Prometheus/OTEL) vào tất cả Services.
- [ ] Vẽ Dashboard Level 1 hiển thị 4 signals này.

**Tuần 2: Define SLO**
- [ ] Họp với Product Owner chốt con số: 99% hay 99.9%?
- [ ] Cấu hình Prometheus Rule để tính toán SLI/SLO hàng ngày.

**Tuần 3: Improve Alerts (Quality over Quantity)**
- [ ] Review lại toàn bộ alerts. Tắt các alert "nhảm" (spam message mà không cần action).
- [ ] Thêm Runbook link vào description của mỗi alert quan trọng.

**Tuần 4: Automation**
- [ ] Viết script tự động dọn disk/log khi có cảnh báo.
- [ ] Cấu hình Auto-scaling cho Kubernetes/Docker Swarm (nếu có).

---

## 📚 6. Resources

*   **Books**: "Site Reliability Engineering" (Google), "Observability Engineering".
*   **Docs**:
    *   [Prometheus Best Practices](https://prometheus.io/docs/practices/)
    *   [Grafana Loki Best Practices](https://grafana.com/docs/loki/latest/best-practices/)
