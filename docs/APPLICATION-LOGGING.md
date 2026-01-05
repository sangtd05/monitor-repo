# APPLICATION LOGGING - Pino và Loki Integration

## 🎯 Tại sao Application Logging khác với System Logging?

### Phân biệt Application Logs vs System Logs

**System Logs** (đã cover trong LOGS.md):
- Logs từ Docker containers
- System logs (`/var/log`)
- Database logs (PostgreSQL, MongoDB)
- **Thu thập bởi**: Promtail (pull/scrape từ files)

**Application Logs** (document này):
- Logs từ application code (NestJS backend)
- Business logic events
- HTTP requests/responses
- Application errors và exceptions
- **Gửi bởi**: Application trực tiếp (push đến Loki)

### Tại sao Push thay vì Pull?

```
Pull Model (Promtail):
Application → stdout/file → Promtail → Loki
│                           │
│                           └─ Promtail phải có quyền đọc files
└─ Phải ghi ra file/stdout

Push Model (Pino-Loki):
Application ──────────────────────▶ Loki
│
└─ Gửi trực tiếp qua HTTP
```

**Ưu điểm Push:**
- ✅ Real-time: Không cần đợi Promtail scrape
- ✅ Structured: Application control log format
- ✅ Context-rich: Dễ thêm metadata (user_id, request_id, etc.)
- ✅ No file I/O: Giảm disk usage

**Nhược điểm Push:**
- ❌ Network dependency: Loki down = logs lost (trừ khi có buffering)
- ❌ Application overhead: HTTP requests từ app
- ❌ Coupling: Application phải biết Loki endpoint

**Khi nào dùng Push?**
- ✅ Application logs với rich context
- ✅ Real-time logging requirements
- ✅ Structured logging (JSON)
- ❌ High-volume logs (dùng Pull)
- ❌ Legacy applications (không thể modify code)

## 🏗️ Kiến trúc Application Logging

```
┌─────────────────────────────────────────────────────────────┐
│              NestJS Application (aisoft-backend)             │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌────────────────────────────────────────────────────┐     │
│  │           Application Code                          │     │
│  │                                                      │     │
│  │  Controllers:                                       │     │
│  │  ├─ UserController.login()                          │     │
│  │  │    logger.info({ userId: 123 }, 'User login')   │     │
│  │  │                                                   │     │
│  │  ├─ OrderController.create()                        │     │
│  │  │    logger.debug({ orderId: 'abc' }, 'Order')    │     │
│  │  │                                                   │     │
│  │  Services:                                          │     │
│  │  ├─ PaymentService.process()                        │     │
│  │  │    logger.warn({ amount: 99 }, 'Retry')         │     │
│  │  │                                                   │     │
│  │  Exception Filters:                                 │     │
│  │  └─ HttpExceptionFilter.catch()                     │     │
│  │       logger.error({ trace }, 'Error')              │     │
│  └──────────────────────┬───────────────────────────────┘     │
│                         │                                     │
│                         ▼                                     │
│  ┌────────────────────────────────────────────────────┐     │
│  │         PinoLoggerService (Custom Logger)           │     │
│  │                                                      │     │
│  │  Implements NestJS LoggerService interface:        │     │
│  │  • log(message, context)                            │     │
│  │  • error(message, trace, context)                   │     │
│  │  • warn(message, context)                           │     │
│  │  • debug(message, context)                          │     │
│  │  • verbose(message, context)                        │     │
│  └──────────────────────┬───────────────────────────────┘     │
│                         │                                     │
│                         ▼                                     │
│  ┌────────────────────────────────────────────────────┐     │
│  │              Pino Logger Instance                   │     │
│  │                                                      │     │
│  │  Configuration:                                     │     │
│  │  • level: 'info'                                    │     │
│  │  • base fields: { service, environment, pid }      │     │
│  │  • multistream: [stdout, lokiStream]               │     │
│  └────────┬────────────────────────────┬────────────────┘     │
│           │                            │                      │
│           │                            │                      │
└───────────┼────────────────────────────┼──────────────────────┘
            │                            │
            │                            │
            ▼                            ▼
    ┌──────────────┐          ┌──────────────────┐
    │   Console    │          │  pino-loki       │
    │   (stdout)   │          │  Stream          │
    │              │          │                  │
    │ Development: │          │ Batching:        │
    │ • Pretty     │          │ • interval: 5s   │
    │ • Colorized  │          │ • Buffer logs    │
    │              │          │                  │
    │ Production:  │          │ Labels:          │
    │ • JSON       │          │ • service_name   │
    │ • Compact    │          │ • environment    │
    └──────────────┘          └────────┬─────────┘
                                       │
                                       │ HTTP POST
                                       │ /loki/api/v1/push
                                       │
                                       ▼
                              ┌─────────────────┐
                              │      Loki       │
                              │  10.99.3.67     │
                              │     :3100       │
                              │                 │
                              │ Receives:       │
                              │ • JSON logs     │
                              │ • Labels        │
                              │ • Timestamps    │
                              └─────────────────┘
```

## 🔧 Pino - High Performance Logger

### Tại sao chọn Pino?

**Benchmark (logs/second):**
```
Pino:     30,000 logs/sec
Winston:  10,000 logs/sec
Bunyan:   15,000 logs/sec
Console:   5,000 logs/sec
```

**Pino nhanh hơn vì:**

1. **Asynchronous by default**
```javascript
// Pino (async)
logger.info('message');  // Non-blocking, returns immediately
// Log được ghi trong background

// Winston (sync)
logger.info('message');  // Blocking, đợi I/O complete
```

2. **Minimal serialization**
```javascript
// Pino
logger.info({ user: { id: 123, name: 'John' } }, 'Login');
// Chỉ serialize khi cần (khi ghi ra stream)

// Winston
logger.info('Login', { user: { id: 123, name: 'John' } });
// Serialize ngay lập tức
```

3. **JSON-first**
```javascript
// Pino output (native JSON)
{"level":30,"time":1735574400,"msg":"Login","user":{"id":123}}

// Winston output (string → JSON)
"2025-12-30 15:30:45 INFO Login user=123"
// Phải parse nếu cần JSON
```

### Pino Core Concepts

#### 1. Log Levels

```javascript
logger.trace('Very detailed');  // level 10
logger.debug('Debug info');     // level 20
logger.info('Information');     // level 30 (default)
logger.warn('Warning');         // level 40
logger.error('Error');          // level 50
logger.fatal('Fatal error');    // level 60
```

**Level filtering:**
```javascript
// logger.level = 'info' (30)
logger.debug('Not logged');  // 20 < 30 → skip
logger.info('Logged');       // 30 >= 30 → log
logger.error('Logged');      // 50 >= 30 → log
```

**Environment-based:**
```javascript
level: process.env.LOG_LEVEL || 'info'

// Development: LOG_LEVEL=debug
// Production: LOG_LEVEL=info
// Troubleshooting: LOG_LEVEL=trace
```

#### 2. Base Fields

**Base fields** = Fields tự động thêm vào mọi log entry.

```typescript
const logger = pino({
    base: {
        service: 'aisoft-backend',
        environment: 'production',
        version: '1.0.0',
        pid: process.pid,
        hostname: os.hostname(),
    }
});

logger.info('User login');
```

**Output:**
```json
{
  "level": 30,
  "time": 1735574400000,
  "service": "aisoft-backend",
  "environment": "production",
  "version": "1.0.0",
  "pid": 12345,
  "hostname": "app-server-01",
  "msg": "User login"
}
```

**Tại sao base fields quan trọng?**
- **Filtering**: `{service="aisoft-backend", environment="production"}`
- **Correlation**: Trace logs từ cùng instance (pid)
- **Debugging**: Biết log từ server nào (hostname)

#### 3. Child Loggers

**Child logger** = Logger kế thừa config + thêm fields riêng.

```typescript
const logger = pino({ base: { service: 'api' } });

// Child logger cho module cụ thể
const userLogger = logger.child({ module: 'UserService' });
const orderLogger = logger.child({ module: 'OrderService' });

userLogger.info('User created');
// { service: 'api', module: 'UserService', msg: 'User created' }

orderLogger.info('Order placed');
// { service: 'api', module: 'OrderService', msg: 'Order placed' }
```

**Use case trong NestJS:**
```typescript
@Injectable()
export class UserService {
    private logger = this.pinoLogger.child({ context: 'UserService' });

    constructor(private pinoLogger: PinoLoggerService) {}

    async createUser(data) {
        this.logger.info({ userId: data.id }, 'Creating user');
        // { context: 'UserService', userId: 123, msg: 'Creating user' }
    }
}
```

## 🔧 pino-loki - Loki Transport

### Cách hoạt động

```
Application                pino-loki              Loki
    │                          │                    │
    │  logger.info('msg')      │                    │
    ├─────────────────────────▶│                    │
    │                          │ Buffer log         │
    │                          │                    │
    │  logger.error('err')     │                    │
    ├─────────────────────────▶│                    │
    │                          │ Buffer log         │
    │                          │                    │
    │  ... more logs ...       │                    │
    │                          │                    │
    │  [5 seconds elapsed]     │                    │
    │                          │                    │
    │                          │ Batch logs         │
    │                          │ Convert to Loki    │
    │                          │ format             │
    │                          │                    │
    │                          │ HTTP POST          │
    │                          ├───────────────────▶│
    │                          │ /loki/api/v1/push  │
    │                          │                    │
    │                          │ ◀── 204 No Content │
    │                          │                    │
```

### Configuration Deep Dive

```typescript
const lokiStream = pinoLoki({
    batching: {
        interval: 5,  // seconds
    },
    host: 'http://10.99.3.67:3100',
    labels: {
        service_name: 'aisoft-backend',
        environment: 'production',
        application: 'aisoft',
    },
    timeout: 30000,
    silenceErrors: false,
});
```

#### 1. Batching

**Tại sao batch?**

**Không batch:**
```
100 logs/second × 60 seconds = 6000 HTTP requests/minute
→ Network overhead
→ Loki overload
```

**Có batch (interval: 5s):**
```
100 logs/second × 5 seconds = 500 logs/batch
500 logs/batch × 12 batches/minute = 6000 logs
→ Chỉ 12 HTTP requests/minute
→ 500x reduction!
```

**Trade-off:**
```
interval: 1s
  ✅ Near real-time
  ❌ More HTTP requests

interval: 5s
  ✅ Balanced
  ✅ Good for most cases

interval: 30s
  ✅ Minimal network
  ❌ Delay cao (logs xuất hiện sau 30s)
```

**Advanced batching:**
```typescript
batching: {
    interval: 5,      // Gửi mỗi 5s
    size: 1000,       // HOẶC khi đủ 1000 logs
}
```

**Ví dụ:**
- Normal traffic: 100 logs/5s → gửi sau 5s
- Traffic spike: 1000 logs/2s → gửi ngay (đủ size)

#### 2. Labels

**Labels trong Loki = Indexed fields.**

```typescript
labels: {
    service_name: 'aisoft-backend',
    environment: 'production',
    application: 'aisoft',
}
```

**Mỗi log entry:**
```json
{
  "streams": [
    {
      "stream": {
        "service_name": "aisoft-backend",
        "environment": "production",
        "application": "aisoft"
      },
      "values": [
        ["1735574400000000000", "{\"level\":30,\"msg\":\"User login\"}"]
      ]
    }
  ]
}
```

**Query trong Grafana:**
```logql
# All logs từ service
{service_name="aisoft-backend"}

# Production logs only
{service_name="aisoft-backend", environment="production"}

# Multiple services
{service_name=~"aisoft-backend|aisoft-frontend"}
```

**⚠️ Label cardinality warning:**

```typescript
// ❌ BAD: High cardinality
labels: {
    service_name: 'aisoft-backend',
    user_id: userId,  // Hàng triệu users = hàng triệu streams
}

// ✅ GOOD: Low cardinality
labels: {
    service_name: 'aisoft-backend',
}
// user_id trong log content, không phải label
logger.info({ userId: 123 }, 'Login');
```

**Rule:** Labels nên có < 100 unique values.

#### 3. Timeout

```typescript
timeout: 30000  // 30 seconds
```

**Khi nào timeout trigger?**
- Loki server chậm
- Network latency cao
- Loki đang overload

**Timeout behavior:**
```
pino-loki gửi batch → Đợi response → 30s → Timeout
│
├─ silenceErrors: false → Throw error, log ra console
└─ silenceErrors: true  → Silent fail, discard logs
```

**Production recommendation:**
```typescript
timeout: 30000,
silenceErrors: false,  // Log errors để debug
```

#### 4. Error Handling

```typescript
silenceErrors: false
```

**Errors có thể xảy ra:**
- Network error (Loki unreachable)
- Timeout
- Loki reject (invalid format, timestamp too old)
- HTTP 4xx/5xx

**silenceErrors: false:**
```
Error: Failed to send logs to Loki: ECONNREFUSED
    at pinoLoki.send (pino-loki/index.js:123)
```
→ Logged ra console, developer biết có vấn đề

**silenceErrors: true:**
→ Silent fail, logs bị mất mà không biết

**Best practice:**
- Development: `false` (debug issues)
- Production: `false` (monitor failures)
- Chỉ dùng `true` nếu logging không critical

## 🔧 Multistream - Console + Loki

### Tại sao cần cả Console và Loki?

```typescript
const streams = [
    { stream: process.stdout },  // Console
    { stream: lokiStream },      // Loki
];

const logger = pino({}, pino.multistream(streams));
```

**Console stream:**
- ✅ Immediate feedback (development)
- ✅ Docker logs (`docker logs container`)
- ✅ Fallback nếu Loki down
- ✅ Debugging local

**Loki stream:**
- ✅ Centralized logging
- ✅ Long-term retention
- ✅ Query và analysis trong Grafana
- ✅ Alerting

**Workflow:**

**Development:**
```bash
npm run start:dev
# Console logs với pino-pretty (colorized)
[15:30:45] INFO: User login
  userId: 123
  context: "UserService"
```

**Production:**
```bash
docker logs aisoft-backend
# JSON logs ra stdout
{"level":30,"time":1735574400,"msg":"User login","userId":123}

# Đồng thời gửi đến Loki
# Query trong Grafana: {service_name="aisoft-backend"}
```

**Loki down scenario:**
```
Application → Multistream
              ├─ Console ✅ (works)
              └─ Loki ❌ (error logged to console)

→ Logs vẫn có trong Docker logs
→ Không mất hoàn toàn
```

### Stream Configuration

**Development (pretty print):**
```typescript
const streams = [
    {
        stream: require('pino-pretty')({
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
        })
    },
    { stream: lokiStream },
];
```

**Production (JSON):**
```typescript
const streams = [
    { stream: process.stdout },  // Raw JSON
    { stream: lokiStream },
];
```

## 🔧 NestJS Integration

### PinoLoggerService Implementation

```typescript
@Injectable()
export class PinoLoggerService implements LoggerService {
    private logger: pino.Logger;

    constructor() {
        const lokiStream = pinoLoki({ /* config */ });
        
        this.logger = pino(
            {
                level: process.env.LOG_LEVEL || 'info',
                base: {
                    service: 'aisoft-backend',
                    environment: process.env.SERVER_ENV || 'development',
                    pid: process.pid,
                },
            },
            pino.multistream([
                { stream: process.stdout },
                { stream: lokiStream },
            ])
        );
    }

    log(message: any, context?: string) {
        this.logger.info({ context }, message);
    }

    error(message: any, trace?: string, context?: string) {
        this.logger.error({ context, trace }, message);
    }
    
    // ... other methods
}
```

**Implement LoggerService interface:**

NestJS `LoggerService` interface:
```typescript
interface LoggerService {
    log(message: any, ...optionalParams: any[]): any;
    error(message: any, ...optionalParams: any[]): any;
    warn(message: any, ...optionalParams: any[]): any;
    debug?(message: any, ...optionalParams: any[]): any;
    verbose?(message: any, ...optionalParams: any[]): any;
}
```

**Mapping to Pino:**
```typescript
log()     → logger.info()
error()   → logger.error()
warn()    → logger.warn()
debug()   → logger.debug()
verbose() → logger.trace()
```

### Using in NestJS App

**1. Register as provider:**
```typescript
// config/module/config.ts
export const DefaultProviders: Provider[] = [
    PinoLoggerService,
    // ...
];
```

**2. Inject into app:**
```typescript
// main.ts
async function bootstrap() {
    const app = await NestFactory.create(AppModule, {
        bufferLogs: true,  // Buffer cho đến khi logger ready
    });
    
    app.useLogger(app.get(PinoLoggerService));
    
    await app.listen(3000);
}
```

**bufferLogs: true:**
```
App startup:
├─ NestFactory.create() → Logs buffered
├─ app.useLogger() → Inject PinoLogger
└─ Buffered logs → Flush qua PinoLogger
```

**Không có bufferLogs:**
```
App startup:
├─ NestFactory.create() → Logs qua default logger (console)
├─ app.useLogger() → Inject PinoLogger
└─ Startup logs không qua Pino → Không gửi Loki
```

### HTTP Logging với nestjs-pino

**Alternative approach:** Sử dụng `nestjs-pino` module.

```typescript
// logger.config.ts
export const loggerConfig: Params = {
    pinoHttp: {
        level: 'info',
        transport: {
            targets: [
                {
                    target: 'pino-pretty',
                    level: 'info',
                    options: { colorize: true },
                },
                {
                    target: 'pino-loki',
                    level: 'debug',
                    options: {
                        batching: { interval: 5000 },
                        host: 'http://10.99.3.67:3100',
                        labels: {
                            service_name: 'aisoft-backend',
                            environment: 'production',
                        },
                    },
                },
            ],
        },
        autoLogging: {
            ignore: (req) => req.url === '/health',
        },
        customLogLevel: (req, res, err) => {
            if (res.statusCode >= 500) return 'error';
            if (res.statusCode >= 400) return 'warn';
            return 'info';
        },
    },
};
```

**Auto-logging features:**

**1. Ignore routes:**
```typescript
autoLogging: {
    ignore: (req) => {
        return req.url === '/health' || req.url === '/metrics';
    },
}
```
→ Health checks không spam logs

**2. Custom log levels:**
```typescript
customLogLevel: (req, res, err) => {
    if (res.statusCode >= 400 && res.statusCode < 500) {
        return 'warn';  // 4xx = client errors
    } else if (res.statusCode >= 500 || err) {
        return 'error';  // 5xx = server errors
    }
    return 'info';  // 2xx, 3xx = success
}
```

**3. Custom messages:**
```typescript
customSuccessMessage: (req, res) => {
    if (res.statusCode === 404) {
        return `Resource not found: ${req.method} ${req.url}`;
    }
    return `${req.method} ${req.url} completed`;
},

customErrorMessage: (req, res, err) => {
    return `${req.method} ${req.url} failed: ${err.message}`;
}
```

**4. Custom properties:**
```typescript
customProps: (req, res) => ({
    context: 'HTTP',
    correlationId: req.headers['x-correlation-id'] || req.id,
    userAgent: req.headers['user-agent'],
    ip: req.ip,
})
```

**HTTP log output:**
```json
{
  "level": 30,
  "time": 1735574400,
  "req": {
    "id": "req-1",
    "method": "GET",
    "url": "/api/users/123",
    "headers": { "user-agent": "Mozilla/5.0" }
  },
  "res": {
    "statusCode": 200
  },
  "responseTime": 45,
  "context": "HTTP",
  "correlationId": "abc-def-123",
  "msg": "GET /api/users/123 completed"
}
```

### Redacting Sensitive Data

```typescript
redact: {
    paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.token',
        'req.body.secret',
    ],
    remove: true,
}
```

**Before redact:**
```json
{
  "req": {
    "headers": {
      "authorization": "Bearer eyJhbGciOiJIUzI1NiIs..."
    },
    "body": {
      "username": "john",
      "password": "secret123"
    }
  }
}
```

**After redact:**
```json
{
  "req": {
    "headers": {},
    "body": {
      "username": "john"
    }
  }
}
```

**Options:**
- `remove: true`: Xóa field hoàn toàn
- `remove: false`: Replace bằng `[Redacted]`

## 💡 Best Practices

### 1. Structured Logging

**❌ Bad:**
```typescript
logger.info('User john logged in from 10.0.0.1');
```

**✅ Good:**
```typescript
logger.info({
    userId: 123,
    username: 'john',
    ip: '10.0.0.1',
    action: 'login',
}, 'User logged in');
```

**Tại sao?**
- Query dễ dàng: `| json | userId = 123`
- Aggregate: `sum by (action) (count_over_time(...))`
- Filter: `| ip = "10.0.0.1"`

### 2. Context in Logs

```typescript
@Injectable()
export class UserService {
    private logger: pino.Logger;

    constructor(private pinoLogger: PinoLoggerService) {
        this.logger = pinoLogger.child({ context: 'UserService' });
    }

    async createUser(data: CreateUserDto) {
        const userId = generateId();
        
        this.logger.info({ userId, email: data.email }, 'Creating user');
        
        try {
            await this.userRepository.save({ id: userId, ...data });
            this.logger.info({ userId }, 'User created successfully');
        } catch (error) {
            this.logger.error({ userId, error: error.message }, 'Failed to create user');
            throw error;
        }
    }
}
```

**Log output:**
```json
{"context":"UserService","userId":"abc-123","email":"john@example.com","msg":"Creating user"}
{"context":"UserService","userId":"abc-123","msg":"User created successfully"}
```

**Query trong Grafana:**
```logql
{service_name="aisoft-backend"} | json | context="UserService" | userId="abc-123"
```

### 3. Error Logging

```typescript
try {
    await riskyOperation();
} catch (error) {
    logger.error({
        error: {
            message: error.message,
            stack: error.stack,
            code: error.code,
        },
        context: {
            userId: 123,
            operation: 'payment',
        },
    }, 'Operation failed');
}
```

### 4. Performance Logging

```typescript
async function processOrder(orderId: string) {
    const start = Date.now();
    
    try {
        await doProcessing(orderId);
        
        const duration = Date.now() - start;
        logger.info({
            orderId,
            duration,
            status: 'success',
        }, 'Order processed');
    } catch (error) {
        const duration = Date.now() - start;
        logger.error({
            orderId,
            duration,
            status: 'failed',
            error: error.message,
        }, 'Order processing failed');
    }
}
```

**Query slow operations:**
```logql
{service_name="aisoft-backend"} 
  | json 
  | duration > 1000
  | line_format "{{.orderId}} took {{.duration}}ms"
```

## 🎓 Tổng kết

### Application Logging Flow

```
1. Application code calls logger
   ├─ logger.info({ userId: 123 }, 'Login')
   └─ logger.error({ trace }, 'Error')

2. PinoLoggerService
   ├─ Add base fields (service, environment, pid)
   └─ Route to multistream

3. Multistream
   ├─ Console stream → stdout (Docker logs)
   └─ Loki stream → pino-loki

4. pino-loki
   ├─ Buffer logs (5 seconds)
   ├─ Batch logs
   └─ HTTP POST to Loki

5. Loki
   ├─ Receive logs
   ├─ Index labels
   └─ Store log content

6. Grafana
   └─ Query logs với LogQL
```

### Key Takeaways

✅ **Pino** = High-performance, JSON-first logger  
✅ **pino-loki** = Push logs trực tiếp đến Loki  
✅ **Multistream** = Console + Loki simultaneously  
✅ **Batching** = Optimize network (5s interval)  
✅ **Labels** = Low cardinality, indexed fields  
✅ **Structured logging** = Rich context, easy query  
✅ **NestJS integration** = LoggerService interface  

### Khi nào dùng Application Logging?

- ✅ Business logic events (user actions, transactions)
- ✅ Application errors và exceptions
- ✅ Performance tracking (operation duration)
- ✅ Audit trail (who did what)
- ✅ Debugging application flow
- ❌ System-level logs (dùng Promtail)
- ❌ Database query logs (database logging)
- ❌ Infrastructure logs (system logs)

### Production Checklist

```typescript
✅ Set appropriate LOG_LEVEL (info in prod)
✅ Configure batching (interval: 5-10s)
✅ Set timeout (30s)
✅ Enable error logging (silenceErrors: false)
✅ Redact sensitive data (passwords, tokens)
✅ Use structured logging (JSON objects)
✅ Add context to logs (userId, requestId)
✅ Monitor Loki connectivity
✅ Keep console stream (fallback)
✅ Low cardinality labels (< 100 unique values)
```
