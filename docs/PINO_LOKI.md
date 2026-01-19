# 🌲 Node.js Logging with Pino & Grafana Alloy

## 📝 Tổng quan

Trong kiến trúc **LGTM Stack** mới sử dụng **Grafana Alloy**, việc thu thập logs từ ứng dụng Node.js (NestJS) được thực hiện theo cơ chế **Centralized Logging** thông qua **Docker Logs**.

Thay vì ứng dụng phải tự gửi logs đến Loki (Direct Push dùng `pino-loki`), ứng dụng chỉ cần ghi logs ra **STDOUT/STDERR** dưới định dạng **JSON**. Grafana Alloy sẽ tự động:
1.  Phát hiện container (`discovery.docker`).
2.  Thu thập logs (`loki.source.docker`).
3.  Gắn labels (`container`, `service_name`).
4.  Đẩy về Loki.

### ✅ Ưu điểm của cách tiếp cận mới
*   **Decoupling**: Ứng dụng không cần biết địa chỉ IP của Loki.
*   **Performance**: Không tốn Network I/O trong main thread của Node.js để gửi logs.
*   **Reliability**: Alloy xử lý việc retry/buffer nếu Loki chết, ứng dụng không bị ảnh hưởng.
*   **Simplicity**: Code logger trong ứng dụng gọn nhẹ hơn rất nhiều.

---

## 🚀 Hướng dẫn Cấu hình

### 1. Cài đặt Dependencies

Gỡ bỏ `pino-loki` nếu đã cài đặt trước đó. Chỉ cần `pino` và `nestjs-pino`.

```bash
npm uninstall pino-loki
npm install pino nestjs-pino
```

### 2. Cấu hình Pino (NestJS)

Sử dụng `nestjs-pino` để cấu hình logger đơn giản, output JSON ra stdout.

**File:** `src/app.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        // Tắt log tự động cho HTTP request nếu muốn control thủ công,
        // hoặc để mặc định để log tất cả requests
        autoLogging: true, 
        
        // Cấu hình format
        transport: process.env.NODE_ENV !== 'production' 
          ? { target: 'pino-pretty' } // Pretty print ở local dev
          : undefined,                // JSON ở production (quan trọng!)

        // Thêm custom fields vào mọi log line
        base: {
          service_name: 'aisoft-backend', // Quan trọng: Alloy dùng field này hoặc container name
          version: '1.0.0',
        },

        // Redact các thông tin nhạy cảm
        redact: ['req.headers.authorization', 'req.body.password'],
        
        // Log level mapping
        level: process.env.LOG_LEVEL || 'info',
      },
    }),
    // ... imports khác
  ],
})
export class AppModule {}
```

### 3. Cấu hình Grafana Alloy (Infrastructure Side)

Đảm bảo `config.alloy` đã có đoạn cấu hình thu thập logs từ Docker.
*(Phần này thường do DevOps cấu hình, Developer chỉ cần biết cơ chế)*.

```alloy
// 1. Tìm kiếm các container đang chạy
discovery.docker "linux" {
  host = "unix:///var/run/docker.sock"
}

// 2. Thu thập logs từ container
loki.source.docker "default" {
  host       = "unix:///var/run/docker.sock"
  targets    = discovery.docker.linux.targets
  forward_to = [loki.process.labels.receiver]
}

// 3. Xử lý labels (Lấy service_name từ container name hoặc docker label)
loki.process "labels" {
  forward_to = [loki.write.default.receiver]
  
  stage {
    // Parse JSON từ log line (nếu log dạng JSON)
    json {
      expressions = {
        level = "level",
        service = "service_name",
        msg = "msg",
      }
    }
  }
  
  // Set labels cho Loki
  stage {
    labels = {
      level = "level",
      service_name = "service", // Dùng service name từ log content
    }
  }
}
```

### 4. Kiểm tra Logs trên Grafana

1.  Truy cập **Grafana** -> **Explore**.
2.  Chọn Datasource **Loki**.
3.  Query logs theo label `container_name` hoặc `service_name` (được Alloy gắn vào).

```logql
{container_name=~".*aisoft-backend.*"} | json
```

---

## 📦 Migration Guide (Từ `pino-loki` sang Alloy)

Nếu bạn đang dùng code cũ (`PinoLoggerService` với `pinoLoki` transport), hãy thực hiện các bước sau để chuyển đổi:

1.  **Xóa `pinoLoki` stream**: Xóa đoạn code `pinoLoki({...})` và `multistream`.
2.  **Chỉ giữ lại `process.stdout`**:
    ```typescript
    // Cũ
    // pino.multistream([{ stream: process.stdout }, { stream: lokiStream }])
    
    // Mới (Mặc định của Pino là stdout)
    pino({
        level: 'info'
    })
    ```
3.  **Xóa biến môi trường `LOKI_URL`**: Ứng dụng không cần biết IP của Loki nữa.

---

## 💡 Best Practices

1.  **Luôn log JSON ở Production**: Không dùng `pino-pretty` ở production. Grafana Alloy cần JSON để parse và filter hiệu quả.
2.  **Sử dụng Correlation ID**: `nestjs-pino` tự động gắn `req.id`. Đảm bảo Frontend gửi header `X-Request-Id` để trace logs xuyên suốt hệ thống.
3.  **Context Logging**: Luôn truyền object context khi log lỗi để dễ debug.
    ```typescript
    this.logger.error({ err, userId: 123 }, 'Failed to process payment'); 
    // Thay vì: this.logger.error('Failed to process payment: ' + err.message);
    ```
