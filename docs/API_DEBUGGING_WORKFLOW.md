# 🔍 API Debugging Workflow - LGTM Stack

## 📋 Tổng quan

Khi user báo lỗi, chúng ta sử dụng **LGTM Stack** để truy vết vấn đề theo quy trình **Time-based Correlation** (Tương quan theo thời gian). Vì Logs và Traces có thể chưa có chung ID, chúng ta sẽ dựa vào **Mốc thời gian** để liên kết dữ liệu.

```mermaid
graph LR
    User([User Report: "Lỗi lúc 10:15"]) --> Metrics[1. METRICS<br/>Xác định khoảng thời gian lỗi]
    Metrics --> Traces[2. TRACES<br/>Tìm API chậm tại 10:15]
    Metrics --> Logs[3. LOGS<br/>Lọc log lỗi quanh 10:15]
    Logs & Traces --> Fix([4. FIX<br/>Xử lý sự cố])
    
    classDef default fill:#f9f9f9,stroke:#333,stroke-width:1px,rx:5,ry:5;
    classDef metrics fill:#ff9999,stroke:#cc0000,stroke-width:2px;
    classDef traces fill:#99ccff,stroke:#0066cc,stroke-width:2px;
    classDef logs fill:#ffcc99,stroke:#cc6600,stroke-width:2px;
    classDef user fill:#e1f5ff,stroke:#0099cc,stroke-width:2px,stroke-dasharray: 5 5;
    classDef fix fill:#ccffcc,stroke:#009900,stroke-width:2px;

    class Metrics metrics;
    class Traces traces;
    class Logs logs;
    class User user;
    class Fix fix;
```

---

## 🎯 Quy trình Debug 5 Bước

### Bước 0: Tiếp nhận sự cố (Quan trọng nhất: THỜI GIAN)
Hỏi user kỹ về thời điểm xảy ra lỗi:
*   "Lỗi xảy ra lúc mấy giờ?"
*   "Lỗi kéo dài bao lâu?"

### Bước 1: METRICS - Khoanh vùng thời gian 🔴
**Mục tiêu**: Xác định chính xác khung giờ sự cố trên biểu đồ.

**Hành động**:
1.  Mở Dashboard **Overiew**.
2.  Kéo Time Range khớp với thời gian user báo (ví dụ: `10:10` đến `10:20`).
3.  Tìm **Error Spike** (đỉnh lỗi) hoặc **Latency Spike**.
    *   *Ví dụ*: Thấy lượng lỗi 500 tăng vọt lúc `10:14:30`.
4.  Ghi nhớ mốc thời gian này: `T = 10:14:30`.

### Bước 2: TRACES - Tìm Request đáng ngờ 🔵
**Mục tiêu**: Xem tại thời điểm `T`, request nào bị chậm hoặc lỗi?

**Hành động**:
1.  Vào **Explore** → **Tempo**.
2.  Set Time Range quanh `T` (ví dụ: `10:14:00` - `10:15:00`).
3.  Filter tìm kiếm:
    *   Status = 500 (nếu là lỗi).
    *   Duration > 2s (nếu là chậm).
4.  Chọn một Trace khớp thời gian đó để xem chi tiết Waterfall.
    *   *Kết quả*: Thấy API `/api/checkout` gọi DB mất 5s.

### Bước 3: LOGS - Đối chiếu thời gian 📝
**Mục tiêu**: Đọc log chi tiết của service tại đúng thời điểm đó.

**Hành động (KHÔNG dùng Trace ID)**:
1.  Vào **Explore** → **Loki**.
2.  Chọn Time Range giống Trace (`10:14:00` - `10:15:00`).
3.  Query lọc theo Service và nội dung lỗi:
    ```logql
    {service_name="backend-api"} 
      |= "error"           # Chỉ tìm log có chữ error
      |= "/api/checkout"   # Và thuộc API đang nghi ngờ
    ```
4.  **Quan sát kết quả**:
    *   Tìm các dòng log có timestamp gần `10:14:30`.
    *   Đọc nội dung: `Connection refused`, `NullPointerException`, v.v.

### Bước 4: Fix & Verify ✅
Sau khi tìm ra nguyên nhân:
1.  Sửa code/DB.
2.  Deploy bản vá.
3.  **Verify**: Quan sát lại Metrics xem tại thời điểm mới, Error Rate đã về 0 chưa.

---

## 🛠️ Ví dụ thực tế (Time-based Debugging)

**Tình huống**: User báo "Lúc nãy tầm 14h30 em tìm kiếm không được".

1.  **Check Metrics**:
    *   Zoom vào khung giờ `14:25` - `14:35`.
    *   Thấy lúc `14:31:15` có một cột lỗi 500 đỏ lòm.
    *   🎯 **Target Time**: `14:31:15` (+/- 5 giây).

2.  **Check Logs (Loki)**:
    *   Filter: `{service_name="product-service"}` (Service tìm kiếm).
    *   Time: `14:31:10` - `14:31:20`.
    *   Thêm filter chữ "Exception" hoặc "Error": `{...} |= "Exception"`.
    *   **Kết quả**: Tìm thấy dòng log lúc `14:31:16`:
        `Error: Database connection pool exhausted.`

3.  **Check Traces (Tempo)** - Tùy chọn:
    *   Nếu Log chưa đủ thông tin, qua Tempo.
    *   Tìm trace quanh `14:31:15`.
    *   Thấy hàng loạt request `GET /products` đang chờ DB Connection (`db.checkout_connection`).

4.  **Kết luận**: DB bị quá tải connection lúc 14:31.

---

## 💡 Mẹo tìm kiếm hiệu quả (Tips)
Vì không có Trace ID để nhảy thằng, bạn cần dùng các kỹ thuật "khoanh vùng":

1.  **Dùng Split View**: Mở Grafana Split View, một bên là Metrics (để canh giờ), một bên là Logs (để query). Chỉnh time range cho cả 2 sync với nhau.
2.  **Lọc theo Context**: Nếu user cung cấp User ID hoặc Email, hãy `|= "user@example.com"` trong Loki. Đây là cách tìm nhanh nhất nếu biết ai bị lỗi.
3.  **Lọc theo URL**: Nếu biết API lỗi, luôn thêm `|= "/api/url"` vào LogQL để loại bớt log rác của API khác.

---

## 📚 Tài liệu tham khảo
*   [Tempo Guide](./TEMPO_GUIDE.md)
*   [Loki Guide](./LOKI_GUIDE.md)
*   [Dashboard Guide](./DASHBOARDS.md)
