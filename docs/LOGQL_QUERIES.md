# 📝 LogQL Query Examples

Tài liệu này hướng dẫn cách query logs từ **Loki** sử dụng LogQL. 
**Lưu ý quan trọng**: Các logs được thu thập bởi **Grafana Alloy** nên có labels chuẩn sau: `{job="docker", service_name="..."}`.

## 🎯 Basic Queries

Cấu trúc cơ bản: `{Log Stream Selector} | Log Pipeline`

### 1. Lọc theo Service
Tìm logs của service cụ thể (dựa trên tên trong docker-compose):

```logql
# Tìm logs của service "backend"
{service_name="backend"}

# Tìm logs của service có tên chứa "db" (mongodb, postgres)
{service_name=~".*db.*"}
```

### 2. Tìm kiếm nội dung (Text Search)
Sử dụng `|=` (contains) hoặc `!=` (not contains).

```logql
# Tìm logs chứa chữ "error"
{service_name="backend"} |= "error"

# Tìm logs KHÔNG chứa "health check"
{service_name="backend"} != "health check"

# Tìm logs khớp regex (bắt đầu bằng Error)
{service_name="backend"} |~ "^Error.*"
```

---

## 🔍 Advanced Queries (JSON Parsing)

Giả sử ứng dụng của bạn ghi log định dạng JSON.

### 1. Format Log Line
Làm đẹp log line để dễ đọc hơn.

```logql
# Parse JSON và chỉ hiện message + timestamp
{service_name="backend"} 
  | json 
  | line_format "{{.timestamp}} - {{.level}} - {{.message}}"
```

### 2. Filter theo JSON Field
Lọc dựa trên giá trị của field trong JSON (ví dụ `level`, `status`, `duration`).

```logql
# Lọc log có level là "error" hoặc "fatal"
{service_name="backend"} | json | level =~ "error|fatal"

# Lọc request có duration > 500ms (Slow requests)
{service_name="backend"} | json | duration > 500
```

### 3. Tìm Log theo TraceID (Kết hợp với Tempo)
Nếu logs có chứa `trace_id`.

```logql
{service_name="backend"} |= "123456789abcdef" 
```

---

## 📊 Metric Queries (Log to Metric)

Biến logs thành metrics để vẽ biểu đồ trong Grafana.

### 1. Đếm số lượng Error Logs (Counter)
Đếm số dòng log lỗi trong 1 phút.

```logql
sum(count_over_time({service_name="backend"} |= "error" [1m]))
```

### 2. Tính toán từ giá trị trong Log (Gauge/Histogram)
Ví dụ tính Average Duration của request từ logs.

```logql
avg_over_time(
  {service_name="backend"} 
    | json 
    | unwrap duration  # duration phải là số trong JSON
[5m])
```

### 3. Top IP truy cập nhiều nhất (Nginx Logs)
Giả sử Nginx log format JSON.

```logql
topk(10, sum by (client_ip) (
  count_over_time({service_name="nginx"} | json [1h])
))
```

---

## 💡 Tips & Tricks

- **Luôn bắt đầu bằng label selector**: `{job="docker"}` hoặc `{service_name="..."}`. Query sẽ nhanh hơn nhiều so với tìm text trên toàn bộ logs.
- **Sử dụng `json` parser**: Nếu log là JSON, dùng parser `| json` giúp bạn filter chính xác hơn (`level="error"` thay vì tìm chữ "error" có thể nằm trong message bình thường).
- **Kết hợp nhiều điều kiện**:
  ```logql
  {service_name="backend"} |= "NullPointerException" != "test"
  ```
