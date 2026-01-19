# DATABASE MONITORING - Giám sát Database với Grafana Alloy

## 🎯 Tổng quan

Tài liệu này mô tả chi tiết kiến trúc giám sát Database (PostgreSQL & MongoDB) sử dụng **Grafana Alloy** làm Unified Agent để thu thập Metric và Log.

Môi trường hiện tại: **Production-ready** (được tối ưu để giảm noise, không log tất cả mọi thứ như môi trường test cũ).

---

## 🏗️ Kiến trúc Database Monitoring

Hệ thống sử dụng container `alloy-db` nằm trong mạng `db-monitor` để thu thập dữ liệu từ Database Containers và Exporters, sau đó push về LGTM Stack.

```mermaid
graph TD
    classDef dbContainer fill:#e1f5ff,stroke:#0066cc,stroke-width:2px,rx:5,ry:5
    classDef exporter fill:#fff9c4,stroke:#fbc02d,stroke-width:2px,rx:5,ry:5
    classDef alloy fill:#ffcc99,stroke:#d79b00,stroke-width:2px,rx:5,ry:5,stroke-dasharray: 5 5
    classDef backend fill:#f3e5f5,stroke:#8e24aa,stroke-width:2px,rx:5,ry:5
    classDef socket fill:#eeeeee,stroke:#666,stroke-width:1px,stroke-dasharray: 3 3

    subgraph "Database Host (10.99.3.67)"
        PG[PostgreSQL Container]:::dbContainer -- Logs (Stderr) --> DockerSock((DockerSock)):::socket
        MG[MongoDB Container]:::dbContainer -- Logs (JSON File) --> DockerSock
        
        PG_EXP[Postgres Exporter]:::exporter -- Pulls Metrics --> PG
        MG_EXP[MongoDB Exporter]:::exporter -- Pulls Metrics --> MG
        
        DockerSock -- Discovers Containers --> ALLOY[Grafana Alloy (alloy-db)]:::alloy
        PG_EXP -- Scrapes :9187 --> ALLOY
        MG_EXP -- Scrapes :9216 --> ALLOY
    end
    
    ALLOY -- OTLP/HTTP Push --> LOKI[Loki :3100]:::backend
    ALLOY -- Remote Write --> PROM[Prometheus :9090]:::backend
```

### Điểm khác biệt so với thiết kế cũ
*   **Collector**: Sử dụng **Grafana Alloy** thay vì Promtail.
*   **Log Strategy**: 
    *   **PostgreSQL**: `log_min_duration_statement=100ms` (Chỉ log query chậm > 100ms và DDL).
    *   **MongoDB**: `slowms=100` (Chỉ profile operation > 100ms).
    *   **Lý do**: Giảm tải I/O và dung lượng lưu trữ, tập trung vào query có vấn đề hiệu năng.

---

## 🐘 1. PostgreSQL Monitor

### Cấu hình Database
File `docker-compose.yml`:
```yaml
command:
  - "postgres"
  - "-c" "log_destination=stderr"        # Ghi log ra stderr để Docker bắt được
  - "-c" "logging_collector=off"         # Tắt collector file nội bộ
  - "-c" "log_min_duration_statement=100" # Chỉ log query > 100ms
  - "-c" "log_statement=ddl"             # Log các lệnh CREATE/ALTER/DROP
  - "-c" "log_line_prefix=%m [%p] user=%u db=%d app=%a client=%h %e " # Format chuẩn để Regex parse
```

### Log Pipeline (Grafana Alloy)
File `db/alloy/config.alloy`:

1.  **Discovery**: Alloy tự tìm container có tên chứa `postgres`.
2.  **Filtering**: Loại bỏ các log rác (time debug, detail lines).
3.  **Parsing (Regex)**:
    *   Regex pattern khớp với `log_line_prefix`.
    *   Extract fields: `timestamp`, `pid`, `user`, `database`, `application`, `client`, `sqlstate`, `level`, `message`.
4.  **Formatting**: Template lại `[unknown]` app thành `undefined`.
5.  **Labels**: Gắn thêm static labels:
    *   `service_name`: Lấy từ biến môi trường `POSTGRES_SERVICE_NAME`
    *   `db_type`: `postgres`

### Key Metrics (Postgres Exporter)
*   **Active Connections**: `pg_stat_activity_count{state="active"}`.
*   **Transaction Rate**: `rate(pg_stat_database_xact_commit[5m])`.
*   **Cache Hit Ratio**: Tỷ lệ hit RAM thay vì đọc Disk.

---

## 🍃 2. MongoDB Monitor

### Cấu hình Database
File `docker-compose.yml`:
```yaml
environment:
  MONGODB_EXTRA_FLAGS: "--profile=1 --slowms=100 --logLevel=1"
```
*   `--profile=1`: Chỉ profile các operation chậm (không phải tất cả).
*   `--slowms=100`: Ngưỡng chậm là 100ms.
*   `--logLevel=1`: Log mức Info (JSON structured).

### Log Pipeline (Grafana Alloy)
File `db/alloy/config.alloy`:

1.  **Discovery**: Alloy tìm container `mongodb`.
2.  **JSON Processing**: MongoDB log mặc định là JSON. Alloy dùng `stage.json` để parse:
    *   `t.$date` -> Timestamp.
    *   `s` -> Severity.
    *   `c` -> Component (COMMAND, ACCESS, etc).
    *   `msg` -> Message.
    *   `attr` -> Attributes (chứa duration, planSummary).
3.  **Advanced Extraction**:
    *   Regex trích xuất `durationMillis` từ attributes.
    *   Regex trích xuất `planSummary` (để biết có bị `COLLSCAN` không).
    *   Regex trích xuất `ns` (namespace/collection).
4.  **Promoted Labels**: Đưa `durationMillis`, `ns`, `planSummary` lên thành Label để query nhanh.

### Key Metrics (MongoDB Exporter)
*   **Operations Status**: `mongodb_op_counters_total` (Insert/Update/Delete/Query).
*   **Replication Lag**: `mongodb_mongod_replset_member_optime_date`.
*   **Cursor Open**: check leak cursor.

---

## 🕵️ Troubleshooting Guide

### 1. Kiểm tra Alloy đang chạy
```bash
docker ps | grep alloy
docker logs alloy-db --tail 100
```
Nếu Alloy lỗi config, nó sẽ restart liên tục hoặc log lỗi cú pháp.

### 2. Debug Log Parsing
Nếu log không hiện trên Grafana hoặc không đúng format:
1.  Vào container Alloy: `docker exec -it alloy-db /bin/bash` (nếu có shell) hoặc check logs stderr.
2.  Kiểm tra labels trên Grafana Explore:
    *   Query: `{service_name="postgres-service"}` (Thay tên service thực tế).
    *   Check xem các labels `user`, `database` có giá trị không hay rỗng.

### 3. Cấu hình Alert đặc thù
Dựa vào data từ Alloy, ta có thể tạo các Alert Rules (đã định nghĩa trong `ALERTS.md`):

*   **Slow Query Alert**:
    *   **Postgres**: Log chứa `duration` > 1s (Dựa vào parser).
    *   **Mongo**: Log JSON có `attr.durationMillis` > 1000.
    
*   **Full Table Scan Alert (Mongo)**:
    *   Log JSON có `planSummary="COLLSCAN"`.

*   **DDL Change Alert (Postgres)**:
    *   Log có `log_statement=ddl` -> Báo động ai đó đang DROP/ALTER bảng.

---

## 📚 Tài liệu tham khảo
*   [Alloy Docker Discovery](https://grafana.com/docs/alloy/latest/reference/components/discovery/discovery.docker/)
*   [Loki Process Stage](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.process/)
*   [PostgreSQL Error Codes](https://www.postgresql.org/docs/current/errcodes-appendix.html)
