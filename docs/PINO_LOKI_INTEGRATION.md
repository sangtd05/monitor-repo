# Pino-Loki Integration Guide

## Tổng quan

Tài liệu này mô tả chi tiết quá trình tích hợp Pino logging với Loki để gửi logs từ NestJS backend (`aisoft-backend`) đến Loki server tại `http://10.99.3.67:3100`.

## Vấn đề ban đầu

- Backend cần gửi logs trực tiếp đến Loki (push method)
- Yêu cầu hiệu suất cao và overhead thấp
- Cần structured logging (JSON format)
- Logs phải có labels để query trong Grafana

## Giải pháp: Pino + pino-loki

### Tại sao chọn Pino?

1. **Hiệu suất cao**: Nhanh hơn Winston đáng kể
2. **Low overhead**: Minimal CPU và memory usage
3. **JSON native**: Tự động format logs thành JSON
4. **Transport system**: Hỗ trợ multiple outputs (console + Loki)

---

## Các bước thực hiện

### 1. Cài đặt dependencies

```bash
npm install pino pino-loki pino-pretty
```

**Packages:**
- `pino`: Core logger
- `pino-loki`: Transport để gửi logs đến Loki
- `pino-pretty`: Pretty print cho development (console output)

### 2. Tạo PinoLoggerService

**File:** `src/common/logger/pino-logger.service.ts`

```typescript
import { Injectable, LoggerService } from '@nestjs/common';
import pino from 'pino';
import pinoLoki from 'pino-loki';

@Injectable()
export class PinoLoggerService implements LoggerService {
    private logger: pino.Logger;

    constructor() {
        // Tạo Loki stream trực tiếp (không dùng workers)
        const lokiStream = pinoLoki({
            batching: {
                interval: 5, // Batch logs mỗi 5 giây
            },
            host: process.env.LOKI_URL || 'http://10.99.3.67:3100',
            labels: {
                service_name: 'aisoft-backend',
                environment: process.env.SERVER_ENV || 'development',
                application: 'aisoft',
            },
            timeout: 30000,
            silenceErrors: false,
        });

        // Tạo multistream: console + Loki
        const streams = [
            { stream: process.stdout }, // Console output
            { stream: lokiStream },      // Loki output
        ];

        this.logger = pino(
            {
                level: process.env.LOG_LEVEL || 'info',
                base: {
                    service: 'aisoft-backend',
                    environment: process.env.SERVER_ENV || 'development',
                    pid: process.pid,
                },
            },
            pino.multistream(streams)
        );
    }

    log(message: any, context?: string) {
        this.logger.info({ context }, message);
    }

    error(message: any, trace?: string, context?: string) {
        this.logger.error({ context, trace }, message);
    }

    warn(message: any, context?: string) {
        this.logger.warn({ context }, message);
    }

    debug(message: any, context?: string) {
        this.logger.debug({ context }, message);
    }

    verbose(message: any, context?: string) {
        this.logger.trace({ context }, message);
    }
}
```

**Key points:**
- Sử dụng `pinoLoki()` stream trực tiếp thay vì transport workers (tránh vấn đề với NestJS context)
- `pino.multistream()` để gửi logs đến cả console và Loki
- Batching interval 5 giây để tối ưu network requests

### 3. Đăng ký PinoLoggerService

**File:** `src/config/module/config.ts`

```typescript
import { PinoLoggerService } from "@common/logger/pino-logger.service";

export const DefaultProviders: Provider[] = [
    PinoLoggerService,
    // ... other providers
];
```

### 4. Inject logger vào NestJS app

**File:** `src/main.ts`

```typescript
import { PinoLoggerService } from "@common/logger/pino-logger.service";

async function bootstrap() {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
        bufferLogs: true, // Buffer logs cho đến khi logger được inject
    });
    
    // Sử dụng Pino logger cho tất cả logs
    app.useLogger(app.get(PinoLoggerService));
    
    // ... rest of bootstrap
}
```

### 5. Cập nhật HttpExceptionFilter

**File:** `src/config/exception/http-exception.filter.ts`

Thay vì inject `PinoLoggerService` (gây lỗi dependency injection), tạo logger instance trực tiếp:

```typescript
import pino from "pino";
import pinoLoki from "pino-loki";

@Catch()
@Injectable()
export class HttpExceptionFilter implements ExceptionFilter {
    private logger: pino.Logger;

    constructor(
        configService: ConfigService<Configuration>,
        @Inject(TRANSFORM_ERROR_MESSAGE_PROVIDER)
        private readonly transform: TransformErrorMessage,
    ) {
        this.environment = configService.get("server.env", { infer: true });
        
        // Tạo Pino logger với Loki stream
        const lokiStream = pinoLoki({
            batching: { interval: 5 },
            host: process.env.LOKI_URL || 'http://10.99.3.67:3100',
            labels: {
                service_name: 'aisoft-backend',
                environment: process.env.SERVER_ENV || 'development',
                application: 'aisoft',
            },
            timeout: 30000,
            silenceErrors: false,
        });

        this.logger = pino(
            {
                level: 'info',
                base: {
                    service: 'aisoft-backend',
                    environment: process.env.SERVER_ENV || 'development',
                },
            },
            pino.multistream([
                { stream: process.stdout },
                { stream: lokiStream },
            ])
        );
    }

    catch(exception: any, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const request = ctx.getRequest<Request>();
        
        // Log error bằng Pino logger
        this.logger.error(
            `${request.method} ${request.originalUrl}`,
            exception.stack,
            'HttpExceptionFilter'
        );
        
        // ... rest of error handling
    }
}
```

### 6. Cấu hình environment variables

**File:** `.env` hoặc `example.env`

```bash
# Loki Configuration
LOKI_URL=http://10.99.3.67:3100
LOG_LEVEL=info
SERVER_ENV=production
```

### 7. Thêm database services vào docker-compose

**File:** `docker-compose.yml`

```yaml
version: '3.8'

services:
  postgresql:
    image: postgres:15-alpine
    container_name: aisoft-backend-postgresql
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    ports:
      - "${POSTGRES_PORT}:5432"
    volumes:
      - ./docker/postgresql:/var/lib/postgresql/data
    networks:
      - aisoft-network
    restart: always

  redis:
    image: redis:7-alpine
    container_name: aisoft-backend-redis
    ports:
      - "${REDIS_PORT}:6379"
    volumes:
      - ./docker/redis:/data
    networks:
      - aisoft-network
    restart: always

  mongodb:
    image: mongo:7
    container_name: aisoft-mongodb
    environment:
      MONGO_INITDB_DATABASE: aisoft
    ports:
      - "27017:27017"
    volumes:
      - ./docker/mongodb:/data/db
    command: ["--replSet", "rs0", "--bind_ip_all"]
    networks:
      - aisoft-network
    restart: always
    healthcheck:
      test: echo "try { rs.status() } catch (err) { rs.initiate({_id:'rs0',members:[{_id:0,host:'localhost:27017'}]}) }" | mongosh --port 27017 --quiet
      interval: 10s
      timeout: 10s
      retries: 5
      start_period: 40s

networks:
  aisoft-network:
    driver: bridge
```

---

## Vấn đề gặp phải và giải pháp

### 1. ❌ nestjs-pino không tương thích với pino-loki

**Vấn đề:** 
- `nestjs-pino` sử dụng transport workers
- Workers không spawn đúng cách trong NestJS context
- Logs không được gửi đến Loki

**Giải pháp:**
- Tạo custom `PinoLoggerService` 
- Sử dụng `pinoLoki()` stream trực tiếp
- Dùng `pino.multistream()` thay vì transport workers

### 2. ❌ Dependency injection error trong HttpExceptionFilter

**Vấn đề:**
```
Nest can't resolve dependencies of the HttpExceptionFilter (..., PinoLoggerService)
```

**Giải pháp:**
- Không inject `PinoLoggerService` vào filter
- Tạo logger instance trực tiếp trong constructor
- Tránh circular dependency issues

### 3. ❌ HTTP request logs không qua Pino

**Vấn đề:**
- `console.error()` trong `HttpExceptionFilter`
- Logs ra console theo format cũ

**Giải pháp:**
- Thay `console.error()` bằng `this.logger.error()`
- Đảm bảo tất cả logs đi qua Pino

---

## Kiểm tra logs trong Grafana

### 1. Truy cập Grafana Explore

```
http://10.99.3.67:3000
```

### 2. Query logs

**Query cơ bản:**
```logql
{service_name="aisoft-backend"}
```

**Filter theo level:**
```logql
{service_name="aisoft-backend"} |= "error"
{service_name="aisoft-backend"} |= "warn"
```

**Filter theo environment:**
```logql
{service_name="aisoft-backend", environment="production"}
```

**Filter theo context:**
```logql
{service_name="aisoft-backend"} | json | context="NestApplication"
```

### 3. Kiểm tra labels

```bash
# Lấy tất cả labels
curl http://10.99.3.67:3100/loki/api/v1/labels

# Lấy values của label service_name
curl http://10.99.3.67:3100/loki/api/v1/label/service_name/values

# Query logs
curl "http://10.99.3.67:3100/loki/api/v1/query_range?query=%7Bservice_name%3D%22aisoft-backend%22%7D&limit=10"
```

---

## Log format

### Startup logs
```json
{
  "level": 30,
  "time": 1767074565257,
  "service": "aisoft-backend",
  "environment": "production",
  "pid": 18916,
  "context": "NestApplication",
  "msg": "Nest application successfully started"
}
```

### HTTP error logs
```json
{
  "level": 50,
  "time": 1767074565300,
  "service": "aisoft-backend",
  "environment": "production",
  "pid": 18916,
  "context": "HttpExceptionFilter",
  "msg": "GET /",
  "trace": "NotFoundException: Cannot GET /\n    at callback..."
}
```

---

## Labels trong Loki

Mỗi log entry có các labels sau:

| Label | Value | Mô tả |
|-------|-------|-------|
| `service_name` | `aisoft-backend` | Tên service |
| `environment` | `production` / `development` | Môi trường |
| `application` | `aisoft` | Tên application |
| `level` | `info`, `warn`, `error`, `debug` | Log level |

---

## Testing

### 1. Test script đơn giản

**File:** `test-pino-loki.js`

```javascript
const pino = require('pino');
const pinoLoki = require('pino-loki');

const lokiStream = pinoLoki({
    batching: { interval: 5 },
    host: 'http://10.99.3.67:3100',
    labels: {
        service_name: 'aisoft-backend-test',
        environment: 'test'
    }
});

const logger = pino(
    { level: 'info' },
    pino.multistream([
        { stream: process.stdout },
        { stream: lokiStream }
    ])
);

logger.info('Test log from pino-loki');
logger.warn('Warning test');
logger.error('Error test');

setTimeout(() => {
    console.log('Logs sent! Check Grafana');
    process.exit(0);
}, 3000);
```

**Chạy test:**
```bash
node test-pino-loki.js
```

**Kiểm tra trong Grafana:**
```logql
{service_name="aisoft-backend-test"}
```

### 2. Kiểm tra app logs

```bash
# Start app
npm start

# Generate logs
curl http://localhost:3000/
curl http://localhost:3000/api

# Đợi 5-10 giây (batching interval)

# Kiểm tra trong Grafana
{service_name="aisoft-backend"}
```

---

## Troubleshooting

### Logs không xuất hiện trong Loki

**Kiểm tra:**

1. **Loki có đang chạy?**
   ```bash
   curl http://10.99.3.67:3100/ready
   ```

2. **Network connectivity?**
   ```bash
   ping 10.99.3.67
   ```

3. **Labels có đúng không?**
   ```bash
   curl http://10.99.3.67:3100/loki/api/v1/label/service_name/values
   ```

4. **App có log ra console không?**
   - Nếu có logs ra console nhưng không có trong Loki → vấn đề với pino-loki stream
   - Nếu không có logs → vấn đề với logger configuration

### Batching delay

Logs có thể delay 5-10 giây do batching. Để test ngay lập tức, set `interval: 1`:

```typescript
batching: {
    interval: 1, // 1 giây
}
```

### Memory issues

Nếu app consume nhiều memory, giảm batch size:

```typescript
batching: {
    interval: 5,
    size: 100, // Giới hạn 100 logs/batch
}
```

---

## Best Practices

### 1. Log levels

- `error`: Errors cần attention ngay
- `warn`: Warnings, deprecated features
- `info`: General information, startup, shutdown
- `debug`: Detailed debugging information
- `trace`: Very detailed tracing

### 2. Structured logging

Luôn log với context:

```typescript
logger.info({ userId: 123, action: 'login' }, 'User logged in');
```

### 3. Sensitive data

Đừng log sensitive data:
- Passwords
- Tokens
- Credit card numbers
- Personal information

### 4. Performance

- Sử dụng batching để giảm network requests
- Set appropriate log levels cho từng environment
- Avoid logging trong tight loops

---

## Kết luận

Pino-Loki integration đã hoàn thành với các tính năng:

✅ Logs được gửi trực tiếp đến Loki (push method)  
✅ High performance với Pino logger  
✅ Structured JSON logging  
✅ Labels để query trong Grafana  
✅ Batching để tối ưu network  
✅ Multi-stream: console + Loki  
✅ Error logging qua HttpExceptionFilter  

**Service name trong Loki:** `aisoft-backend`  
**Loki endpoint:** `http://10.99.3.67:3100`  
**Grafana query:** `{service_name="aisoft-backend"}`
