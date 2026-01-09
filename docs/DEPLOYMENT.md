# HƯỚNG DẪN TRIỂN KHAI HỆ THỐNG MONITORING

> **Tài liệu này hướng dẫn triển khai hệ thống LGTM Stack theo mô hình tập trung (Centralized Monitoring)**

## 📋 Mục lục

- [1. Tổng quan Kiến trúc](#1-tổng-quan-kiến-trúc)
- [2. Mô hình Vật lý](#2-mô-hình-vật-lý)
- [3. Yêu cầu Hệ thống](#3-yêu-cầu-hệ-thống)
- [4. Cấu hình Mạng và Firewall](#4-cấu-hình-mạng-và-firewall)
- [5. Triển khai Monitoring Server](#5-triển-khai-monitoring-server)
- [6. Triển khai Exporters trên Monitored Servers](#6-triển-khai-exporters-trên-monitored-servers)
- [7. Xác minh Hoạt động](#7-xác-minh-hoạt-động)
- [8. Troubleshooting](#8-troubleshooting)

---

## 1. Tổng quan Kiến trúc

### 1.1. Mô hình Triển khai

Hệ thống monitoring được triển khai theo mô hình **Centralized Monitoring** với các đặc điểm:

- **1 Monitoring Server**: Chứa toàn bộ LGTM Stack (Loki, Grafana, Tempo, Prometheus)
- **N Monitored Servers**: Các máy chủ được giám sát, chỉ cài đặt exporters
- **Pull-based Architecture**: Prometheus chủ động scrape metrics từ exporters
- **Push-based Logs**: Applications và Promtail push logs đến Loki

### 1.2. Kiến trúc Tổng quan

```mermaid
graph TB
    subgraph "MONITORING SERVER<br/>10.170.100.X"
        subgraph "LGTM Stack"
            GRAFANA[Grafana<br/>:3000<br/>Visualization UI]
            PROM[Prometheus<br/>:9090<br/>Metrics Storage]
            LOKI[Loki<br/>:3100<br/>Logs Storage]
            TEMPO[Tempo<br/>:3200<br/>Traces Storage]
            OTEL[OTEL Collector<br/>:4317/:4318<br/>Traces Receiver]
            ALERT[Alertmanager<br/>:9093<br/>Alert Routing]
            PROMTAIL_M[Promtail<br/>Log Collector]
        end
    end
    
    subgraph "MONITORED SERVERS<br/>10.170.100.Y"
        subgraph "System Exporters"
            NODE[Node Exporter<br/>:9100<br/>System Metrics]
            CADVISOR[cAdvisor<br/>:8080<br/>Container Metrics]
        end
        
        subgraph "Service Exporters"
            NGINX_EXP[Nginx Exporter<br/>:9113<br/>Web Server Metrics]
            MONGO_EXP[MongoDB Exporter<br/>:9216<br/>Database Metrics]
            PG_EXP[PostgreSQL Exporter<br/>:9187<br/>Database Metrics]
        end
        
        subgraph "Applications"
            APP[NestJS App<br/>Business Logic]
        end
    end
    
    subgraph "External Services"
        TELEGRAM[Telegram Bot<br/>Alert Notifications]
    end
    
    %% Metrics Flow (Pull)
    PROM -->|Scrape :9100| NODE
    PROM -->|Scrape :8080| CADVISOR
    PROM -->|Scrape :9113| NGINX_EXP
    PROM -->|Scrape :9216| MONGO_EXP
    PROM -->|Scrape :9187| PG_EXP
    
    %% Logs Flow (Push)
    APP -->|Push HTTP| LOKI
    PROMTAIL_M -->|Push HTTP| LOKI
    
    %% Traces Flow (Push)
    APP -->|OTLP gRPC/HTTP| OTEL
    OTEL --> TEMPO
    
    %% Alerting Flow
    PROM --> ALERT
    ALERT --> TELEGRAM
    
    %% Visualization
    PROM --> GRAFANA
    LOKI --> GRAFANA
    TEMPO --> GRAFANA
    
    style GRAFANA fill:#99ff99
    style PROM fill:#ff9999
    style LOKI fill:#ffcc99
    style TEMPO fill:#cc99ff
    style NODE fill:#e1f5ff
    style CADVISOR fill:#e1f5ff
    style NGINX_EXP fill:#fff9c4
    style MONGO_EXP fill:#fff9c4
    style PG_EXP fill:#fff9c4
```

---

## 2. Mô hình Vật lý

### 2.1. Sơ đồ Triển khai Vật lý

```mermaid
graph TB
    subgraph "DATA CENTER / CLOUD"
        subgraph "MONITORING SERVER"
            MS[Server: monitor-01<br/>IP: 10.170.100.X<br/>OS: Ubuntu 22.04<br/>RAM: 16GB<br/>CPU: 8 cores<br/>Disk: 500GB SSD]
            
            subgraph "Docker Containers"
                C1[prometheus:9090]
                C2[grafana:3000]
                C3[loki:3100]
                C4[tempo:3200]
                C5[otel-collector:4317/4318]
                C6[alertmanager:9093]
                C7[promtail:9080]
            end
            
            MS --> C1
            MS --> C2
            MS --> C3
            MS --> C4
            MS --> C5
            MS --> C6
            MS --> C7
        end
        
        subgraph "MONITORED SERVERS GROUP 1<br/>Application Servers"
            APP1[Server: app-01<br/>IP: 10.170.100.210<br/>Exporters:<br/>- Node Exporter :9100<br/>- cAdvisor :8080<br/>- NestJS App]
            
            APP2[Server: app-02<br/>IP: 10.170.100.181<br/>Exporters:<br/>- Node Exporter :9100<br/>- cAdvisor :8080<br/>- NestJS App]
        end
        
        subgraph "MONITORED SERVERS GROUP 2<br/>Database Servers"
            DB1[Server: db-mongo-01<br/>IP: 10.170.100.88<br/>Exporters:<br/>- Node Exporter :9100<br/>- MongoDB Exporter :9216]
            
            DB2[Server: db-postgres-01<br/>IP: 10.170.100.24<br/>Exporters:<br/>- Node Exporter :9100<br/>- PostgreSQL Exporter :9187]
        end
        
        subgraph "MONITORED SERVERS GROUP 3<br/>Web Servers"
            WEB1[Server: web-01<br/>IP: 10.170.100.180<br/>Exporters:<br/>- Node Exporter :9100<br/>- Nginx Exporter :9113<br/>- cAdvisor :8080]
            
            WEB2[Server: web-02<br/>IP: 10.170.100.182<br/>Exporters:<br/>- Node Exporter :9100<br/>- Nginx Exporter :9113<br/>- cAdvisor :8080]
        end
    end
    
    MS -.->|Scrape Metrics| APP1
    MS -.->|Scrape Metrics| APP2
    MS -.->|Scrape Metrics| DB1
    MS -.->|Scrape Metrics| DB2
    MS -.->|Scrape Metrics| WEB1
    MS -.->|Scrape Metrics| WEB2
    
    APP1 -.->|Push Logs/Traces| MS
    APP2 -.->|Push Logs/Traces| MS
    
    style MS fill:#99ff99
    style APP1 fill:#e1f5ff
    style APP2 fill:#e1f5ff
    style DB1 fill:#fff9c4
    style DB2 fill:#fff9c4
    style WEB1 fill:#ffe0b2
    style WEB2 fill:#ffe0b2
```

### 2.2. Phân loại Đối tượng Triển khai

| Đối tượng | Vai trò | Thành phần cài đặt | Số lượng |
|-----------|---------|-------------------|----------|
| **Monitoring Server** | Thu thập, lưu trữ, hiển thị dữ liệu | LGTM Stack (7 containers) | 1 |
| **Application Servers** | Chạy ứng dụng | Node Exporter, cAdvisor, App SDK | N |
| **Database Servers** | Chạy databases | Node Exporter, DB Exporters | N |
| **Web Servers** | Chạy web servers | Node Exporter, Nginx Exporter, cAdvisor | N |
| **Kubernetes Nodes** | Container orchestration | Node Exporter, cAdvisor, kube-state-metrics | N |

---

## 3. Yêu cầu Hệ thống

### 3.1. Monitoring Server

#### Phần cứng tối thiểu

| Resource | Minimum | Recommended | Production |
|----------|---------|-------------|------------|
| **CPU** | 4 cores | 8 cores | 16 cores |
| **RAM** | 8 GB | 16 GB | 32 GB |
| **Disk** | 200 GB SSD | 500 GB SSD | 1 TB NVMe |
| **Network** | 1 Gbps | 10 Gbps | 10 Gbps |

> **Lưu ý**: Disk space phụ thuộc vào:
> - Số lượng monitored servers
> - Retention period (mặc định: 15 days cho metrics, 7 days cho logs/traces)
> - Scrape interval (mặc định: 15s)

#### Phần mềm

```bash
OS: Ubuntu 22.04 LTS / Debian 12 / RHEL 8+
Docker: 24.0+
Docker Compose: 2.20+
```

### 3.2. Monitored Servers

#### Phần cứng

- **CPU**: Exporters tiêu thụ < 1% CPU
- **RAM**: ~50-200 MB per exporter
- **Disk**: ~100 MB cho binaries

#### Phần mềm

```bash
OS: Linux (any distribution)
Optional: Docker (nếu dùng cAdvisor)
```

---

## 4. Cấu hình Mạng và Firewall

### 4.1. Sơ đồ Network Flow

```mermaid
sequenceDiagram
    participant MS as Monitoring Server<br/>10.170.100.X
    participant APP as Application Server<br/>10.170.100.Y
    participant DB as Database Server<br/>10.170.100.Z
    participant USER as User Browser
    participant TG as Telegram
    
    Note over MS,DB: METRICS COLLECTION (Pull Model)
    
    MS->>APP: HTTP GET :9100/metrics<br/>(Node Exporter)
    APP-->>MS: Response: Metrics
    
    MS->>APP: HTTP GET :8080/metrics<br/>(cAdvisor)
    APP-->>MS: Response: Metrics
    
    MS->>DB: HTTP GET :9216/metrics<br/>(MongoDB Exporter)
    DB-->>MS: Response: Metrics
    
    Note over MS,DB: LOGS & TRACES (Push Model)
    
    APP->>MS: HTTP POST :3100/loki/api/v1/push<br/>(Logs)
    APP->>MS: gRPC :4317<br/>(Traces)
    
    Note over MS,USER: VISUALIZATION
    
    USER->>MS: HTTPS :3000<br/>(Grafana UI)
    MS-->>USER: Response: Dashboard
    
    Note over MS,TG: ALERTING
    
    MS->>TG: HTTPS<br/>(Alert Notifications)
```

### 4.2. Firewall Rules

#### Trên Monitoring Server

**Inbound Rules** (Cho phép từ bên ngoài vào):

| Port | Protocol | Source | Service | Mục đích |
|------|----------|--------|---------|----------|
| 3000 | TCP | User IPs | Grafana | Web UI access |
| 3100 | TCP | Monitored Servers | Loki | Receive logs |
| 4317 | TCP | Monitored Servers | OTEL Collector | Receive traces (gRPC) |
| 4318 | TCP | Monitored Servers | OTEL Collector | Receive traces (HTTP) |
| 9090 | TCP | Admin IPs | Prometheus | API access (optional) |

**Outbound Rules** (Cho phép từ trong ra):

| Port | Protocol | Destination | Service | Mục đích |
|------|----------|-------------|---------|----------|
| 9100 | TCP | Monitored Servers | Node Exporter | Scrape system metrics |
| 8080 | TCP | Monitored Servers | cAdvisor | Scrape container metrics |
| 9113 | TCP | Web Servers | Nginx Exporter | Scrape nginx metrics |
| 9216 | TCP | DB Servers | MongoDB Exporter | Scrape MongoDB metrics |
| 9187 | TCP | DB Servers | PostgreSQL Exporter | Scrape PostgreSQL metrics |
| 443 | TCP | api.telegram.org | Alertmanager | Send alerts |

#### Trên Monitored Servers

**Inbound Rules**:

| Port | Protocol | Source | Service | Mục đích |
|------|----------|--------|---------|----------|
| 9100 | TCP | Monitoring Server | Node Exporter | Metrics endpoint |
| 8080 | TCP | Monitoring Server | cAdvisor | Metrics endpoint |
| 9113 | TCP | Monitoring Server | Nginx Exporter | Metrics endpoint |
| 9216 | TCP | Monitoring Server | MongoDB Exporter | Metrics endpoint |
| 9187 | TCP | Monitoring Server | PostgreSQL Exporter | Metrics endpoint |

**Outbound Rules**:

| Port | Protocol | Destination | Service | Mục đích |
|------|----------|-------------|---------|----------|
| 3100 | TCP | Monitoring Server | Loki | Push logs |
| 4317 | TCP | Monitoring Server | OTEL Collector | Push traces |

### 4.3. Ví dụ Cấu hình Firewall (UFW)

#### Trên Monitoring Server

```bash
# Allow Grafana access
sudo ufw allow from any to any port 3000 proto tcp comment 'Grafana UI'

# Allow logs/traces from monitored servers
sudo ufw allow from 10.170.100.0/24 to any port 3100 proto tcp comment 'Loki'
sudo ufw allow from 10.170.100.0/24 to any port 4317 proto tcp comment 'OTEL gRPC'
sudo ufw allow from 10.170.100.0/24 to any port 4318 proto tcp comment 'OTEL HTTP'

# Allow outbound to exporters (usually allowed by default)
sudo ufw allow out to 10.170.100.0/24 port 9100 proto tcp comment 'Node Exporter'
sudo ufw allow out to 10.170.100.0/24 port 8080 proto tcp comment 'cAdvisor'
```

#### Trên Monitored Servers

```bash
# Allow Prometheus scraping
sudo ufw allow from <MONITORING_SERVER_IP> to any port 9100 proto tcp comment 'Node Exporter'
sudo ufw allow from <MONITORING_SERVER_IP> to any port 8080 proto tcp comment 'cAdvisor'

# Allow outbound to Loki/OTEL (usually allowed by default)
sudo ufw allow out to <MONITORING_SERVER_IP> port 3100 proto tcp comment 'Loki'
sudo ufw allow out to <MONITORING_SERVER_IP> port 4317 proto tcp comment 'OTEL'
```

---

## 5. Triển khai Monitoring Server

### 5.1. Chuẩn bị

```bash
# 1. Update system
sudo apt update && sudo apt upgrade -y

# 2. Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# 3. Install Docker Compose
sudo apt install docker-compose-plugin -y

# 4. Add user to docker group
sudo usermod -aG docker $USER
newgrp docker

# 5. Verify installation
docker --version
docker compose version
```

### 5.2. Clone Repository

```bash
# Clone monitoring repository
git clone <YOUR_REPO_URL> /opt/monitor-repo
cd /opt/monitor-repo/grafana-prometheus
```

### 5.3. Cấu hình Environment Variables

```bash
# Copy environment template
cp .env.example .env

# Edit environment variables
nano .env
```

**File `.env`**:

```env
# Grafana
GRAFANA_PASSWORD=your_secure_password

# Alertmanager
ALERTMANAGER_URL=http://<MONITORING_SERVER_IP>:9093
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id

# Database Exporters (nếu chạy trên monitoring server)
MONGODB_URI_PTIT=mongodb://user:pass@10.170.100.88:27017/admin
POSTGRES_DSN_PTIT=postgresql://user:pass@10.170.100.24:5432/postgres?sslmode=disable
```

### 5.4. Cấu hình Monitoring Targets

#### File `prometheus/targets.node.json`

Danh sách các Node Exporters cần scrape:

```json
[
  {
    "targets": [
      "10.170.100.210:9100",
      "10.170.100.181:9100",
      "10.170.100.88:9100",
      "10.170.100.24:9100"
    ],
    "labels": {
      "job": "node_exporter"
    }
  }
]
```

#### File `prometheus/targets.cadvisor.json`

```json
[
  {
    "targets": [
      "10.170.100.210:8080",
      "10.170.100.181:8080"
    ],
    "labels": {
      "job": "cadvisor"
    }
  }
]
```

#### File `prometheus/targets.nginx.json`

```json
[
  {
    "targets": [
      "10.170.100.180:9113",
      "10.170.100.182:9113"
    ],
    "labels": {
      "job": "nginx"
    }
  }
]
```

### 5.5. Khởi động LGTM Stack

```bash
# Start all services
docker compose up -d

# Verify containers are running
docker compose ps

# Check logs
docker compose logs -f
```

### 5.6. Truy cập Grafana

```
URL: http://<MONITORING_SERVER_IP>:3000
Username: admin
Password: <GRAFANA_PASSWORD from .env>
```

**Kiểm tra Datasources**:
1. Vào **Configuration → Data Sources**
2. Verify: Prometheus, Loki, Tempo đều status **Working**

---

## 6. Triển khai Exporters trên Monitored Servers

### 6.1. Node Exporter (System Metrics)

> **Cài đặt trên**: TẤT CẢ các monitored servers

#### Cách 1: Binary Installation (Recommended)

```bash
# 1. Download Node Exporter
cd /tmp
wget https://github.com/prometheus/node_exporter/releases/download/v1.7.0/node_exporter-1.7.0.linux-amd64.tar.gz

# 2. Extract
tar xvfz node_exporter-1.7.0.linux-amd64.tar.gz
sudo mv node_exporter-1.7.0.linux-amd64/node_exporter /usr/local/bin/

# 3. Create systemd service
sudo tee /etc/systemd/system/node_exporter.service > /dev/null <<EOF
[Unit]
Description=Node Exporter
After=network.target

[Service]
Type=simple
User=node_exporter
ExecStart=/usr/local/bin/node_exporter

[Install]
WantedBy=multi-user.target
EOF

# 4. Create user
sudo useradd -rs /bin/false node_exporter

# 5. Start service
sudo systemctl daemon-reload
sudo systemctl enable node_exporter
sudo systemctl start node_exporter

# 6. Verify
curl http://localhost:9100/metrics
```

#### Cách 2: Docker Installation

```bash
docker run -d \
  --name node_exporter \
  --restart unless-stopped \
  --net="host" \
  --pid="host" \
  -v "/:/host:ro,rslave" \
  quay.io/prometheus/node-exporter:latest \
  --path.rootfs=/host
```

### 6.2. cAdvisor (Container Metrics)

> **Cài đặt trên**: Servers chạy Docker containers

```bash
docker run -d \
  --name cadvisor \
  --restart unless-stopped \
  --volume=/:/rootfs:ro \
  --volume=/var/run:/var/run:ro \
  --volume=/sys:/sys:ro \
  --volume=/var/lib/docker/:/var/lib/docker:ro \
  --volume=/dev/disk/:/dev/disk:ro \
  --publish=8080:8080 \
  --detach=true \
  gcr.io/cadvisor/cadvisor:latest

# Verify
curl http://localhost:8080/metrics
```

### 6.3. MongoDB Exporter

> **Cài đặt trên**: MongoDB servers

#### Cách 1: Docker (Recommended)

```bash
# 1. Create .env file
cat > /opt/mongodb-exporter/.env <<EOF
MONGODB_URI=mongodb://exporter_user:password@localhost:27017/admin
EOF

# 2. Run exporter
docker run -d \
  --name mongodb_exporter \
  --restart unless-stopped \
  --env-file /opt/mongodb-exporter/.env \
  -p 9216:9216 \
  percona/mongodb_exporter:0.40 \
  --mongodb.uri=\${MONGODB_URI} \
  --collect-all \
  --compatible-mode

# 3. Verify
curl http://localhost:9216/metrics
```

#### Tạo MongoDB User cho Exporter

```javascript
// Connect to MongoDB
mongosh

// Create exporter user
use admin
db.createUser({
  user: "exporter_user",
  pwd: "secure_password",
  roles: [
    { role: "clusterMonitor", db: "admin" },
    { role: "read", db: "local" }
  ]
})
```

### 6.4. PostgreSQL Exporter

> **Cài đặt trên**: PostgreSQL servers

#### Cách 1: Docker (Recommended)

```bash
# 1. Create .env file
cat > /opt/postgres-exporter/.env <<EOF
DATA_SOURCE_NAME=postgresql://exporter_user:password@localhost:5432/postgres?sslmode=disable
EOF

# 2. Run exporter
docker run -d \
  --name postgres_exporter \
  --restart unless-stopped \
  --env-file /opt/postgres-exporter/.env \
  -p 9187:9187 \
  quay.io/prometheuscommunity/postgres-exporter:latest

# 3. Verify
curl http://localhost:9187/metrics
```

#### Tạo PostgreSQL User cho Exporter

```sql
-- Connect to PostgreSQL
psql -U postgres

-- Create exporter user
CREATE USER exporter_user WITH PASSWORD 'secure_password';
ALTER USER exporter_user SET SEARCH_PATH TO exporter_user,pg_catalog;

-- Grant permissions
GRANT pg_monitor TO exporter_user;
GRANT SELECT ON pg_stat_database TO exporter_user;
```

### 6.5. Nginx Exporter

> **Cài đặt trên**: Nginx servers

#### Bước 1: Enable Nginx Stub Status

```nginx
# /etc/nginx/sites-available/default
server {
    listen 80;
    
    location /stub_status {
        stub_status on;
        access_log off;
        allow 127.0.0.1;
        deny all;
    }
}
```

```bash
# Reload Nginx
sudo nginx -t
sudo systemctl reload nginx

# Verify
curl http://localhost/stub_status
```

#### Bước 2: Install Nginx Exporter

```bash
docker run -d \
  --name nginx_exporter \
  --restart unless-stopped \
  --net=host \
  nginx/nginx-prometheus-exporter:latest \
  -nginx.scrape-uri=http://localhost/stub_status

# Verify
curl http://localhost:9113/metrics
```

---

## 7. Xác minh Hoạt động

### 7.1. Kiểm tra Exporters

```bash
# Trên mỗi monitored server, verify exporters đang chạy:

# Node Exporter
curl http://localhost:9100/metrics | grep "node_"

# cAdvisor
curl http://localhost:8080/metrics | grep "container_"

# MongoDB Exporter
curl http://localhost:9216/metrics | grep "mongodb_"

# PostgreSQL Exporter
curl http://localhost:9187/metrics | grep "pg_"

# Nginx Exporter
curl http://localhost:9113/metrics | grep "nginx_"
```

### 7.2. Kiểm tra Prometheus Targets

1. Truy cập Prometheus UI: `http://<MONITORING_SERVER_IP>:9090`
2. Vào **Status → Targets**
3. Verify tất cả targets đều **UP**

### 7.3. Kiểm tra Grafana Dashboards

1. Truy cập Grafana: `http://<MONITORING_SERVER_IP>:3000`
2. Vào **Dashboards**
3. Kiểm tra các dashboards:
   - Node Exporter Full
   - Docker Container Metrics
   - MongoDB Overview
   - PostgreSQL Overview

### 7.4. Kiểm tra Logs trong Loki

```bash
# Test push logs từ monitored server
curl -X POST http://<MONITORING_SERVER_IP>:3100/loki/api/v1/push \
  -H "Content-Type: application/json" \
  -d '{
    "streams": [
      {
        "stream": {
          "job": "test",
          "host": "'"$(hostname)"'"
        },
        "values": [
          ["'"$(date +%s)000000000"'", "Test log message from '"$(hostname)"'"]
        ]
      }
    ]
  }'
```

Kiểm tra trong Grafana Explore:
```logql
{job="test"}
```

### 7.5. Kiểm tra Alerting

```bash
# Trigger test alert (stop Node Exporter)
sudo systemctl stop node_exporter

# Sau 5 phút, kiểm tra:
# 1. Prometheus Alerts: http://<MONITORING_SERVER_IP>:9090/alerts
# 2. Alertmanager: http://<MONITORING_SERVER_IP>:9093
# 3. Telegram bot sẽ gửi notification

# Restore
sudo systemctl start node_exporter
```

---

## 8. Troubleshooting

### 8.1. Exporter không UP trong Prometheus

**Triệu chứng**: Target hiển thị **DOWN** trong Prometheus

**Nguyên nhân**:
1. Firewall chặn port
2. Exporter không chạy
3. Sai IP/port trong config

**Giải pháp**:

```bash
# 1. Kiểm tra exporter đang chạy
curl http://localhost:9100/metrics  # Trên monitored server

# 2. Kiểm tra từ monitoring server
curl http://<MONITORED_SERVER_IP>:9100/metrics  # Từ monitoring server

# 3. Kiểm tra firewall
sudo ufw status
sudo ufw allow from <MONITORING_SERVER_IP> to any port 9100

# 4. Kiểm tra logs
docker logs node_exporter  # Nếu dùng Docker
sudo journalctl -u node_exporter -f  # Nếu dùng systemd
```

### 8.2. Logs không hiển thị trong Loki

**Triệu chứng**: Không thấy logs trong Grafana Explore

**Giải pháp**:

```bash
# 1. Kiểm tra Loki đang chạy
docker compose ps loki

# 2. Kiểm tra Loki logs
docker compose logs loki

# 3. Test push logs
curl -X POST http://<MONITORING_SERVER_IP>:3100/loki/api/v1/push \
  -H "Content-Type: application/json" \
  -d '{"streams":[{"stream":{"job":"test"},"values":[["'$(date +%s)000000000'","test"]]}]}'

# 4. Kiểm tra firewall
sudo ufw allow from any to any port 3100
```

### 8.3. Grafana không kết nối được Datasources

**Triệu chứng**: Datasources hiển thị **Error**

**Giải pháp**:

```bash
# 1. Kiểm tra tất cả services đang chạy
docker compose ps

# 2. Kiểm tra network
docker network inspect grafana-prometheus_monitoring

# 3. Test từ Grafana container
docker exec -it grafana curl http://prometheus:9090/-/healthy
docker exec -it grafana curl http://loki:3100/ready
docker exec -it grafana curl http://tempo:3200/ready

# 4. Restart Grafana
docker compose restart grafana
```

### 8.4. High Memory Usage trên Prometheus

**Triệu chứng**: Prometheus container sử dụng quá nhiều RAM

**Giải pháp**:

```bash
# 1. Giảm retention period
# Edit docker-compose.yml
--storage.tsdb.retention.time=7d  # Thay vì 15d

# 2. Giảm scrape interval
# Edit prometheus/prometheus.yml
global:
  scrape_interval: 30s  # Thay vì 15s

# 3. Limit memory
# Edit docker-compose.yml
services:
  prometheus:
    deploy:
      resources:
        limits:
          memory: 4G

# 4. Restart
docker compose up -d prometheus
```

### 8.5. Alerts không gửi đến Telegram

**Triệu chứng**: Alerts firing nhưng không nhận được notification

**Giải pháp**:

```bash
# 1. Kiểm tra Alertmanager logs
docker compose logs alertmanager

# 2. Verify Telegram bot token
# Test API
curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getMe

# 3. Verify chat ID
# Gửi message đến bot, sau đó:
curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates

# 4. Test alert manually
curl -X POST http://localhost:9093/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d '[{
    "labels": {"alertname": "TestAlert", "severity": "critical"},
    "annotations": {"summary": "Test alert"}
  }]'

# 5. Restart Alertmanager
docker compose restart alertmanager
```

---

## 📚 Tài liệu Tham khảo

- [OVERVIEW.md](./OVERVIEW.md) - Tổng quan hệ thống
- [METRICS.md](./METRICS.md) - Chi tiết về Metrics
- [LOGS.md](./LOGS.md) - Chi tiết về Logs
- [TRACES.md](./TRACES.md) - Chi tiết về Traces
- [DATABASE-MONITORING.md](./DATABASE-MONITORING.md) - Giám sát Databases

---

**Version**: 1.0.0  
**Last Updated**: 2026-01-09  
**Maintainer**: DevOps Team
