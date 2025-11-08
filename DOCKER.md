# Docker Deployment Guide

This guide explains how to run the Fax Batch Sender application using Docker Compose, which bundles both the PostgreSQL database and the REST API server in a self-contained environment.

## Prerequisites

- Docker Engine 20.10 or later
- Docker Compose V2 (or docker-compose 1.29+)
- Port 3000 and 5432 available on your host machine

## Quick Start

### 1. Configure Environment Variables

Copy the Docker environment template and configure your Fax API credentials:

```bash
cp .env.docker .env
```

Edit `.env` and set your OpenText Fax API credentials:

```env
FAX_API_URL=https://your-fax-server/RightFax/API
FAX_USERNAME=your_username
FAX_PASSWORD=your_password
```

### 2. Start the Services

Start both the database and server:

```bash
docker-compose up -d
```

This will:
- Pull the PostgreSQL 15 Alpine image
- Build the Node.js server image
- Create persistent volumes for database data and uploads
- Initialize the database with the schema
- Start both services with health checks

### 3. Verify the Deployment

Check that both services are running:

```bash
docker-compose ps
```

You should see:
```
NAME            IMAGE                   STATUS          PORTS
fax-database    postgres:15-alpine      Up (healthy)    0.0.0.0:5432->5432/tcp
fax-server      rfrestperf-server       Up (healthy)    0.0.0.0:3000->3000/tcp
```

Test the server health endpoint:

```bash
curl http://localhost:3000/health
```

### 4. Access the Application

- **Web UI**: http://localhost:3000
- **API**: http://localhost:3000/api/*
- **Database**: localhost:5432 (credentials: postgres/postgres)

## Docker Compose Services

### Database Service

- **Image**: postgres:15-alpine
- **Container Name**: fax-database
- **Port**: 5432
- **Volume**: postgres_data (persistent)
- **Auto-initialization**: Runs schema.sql on first start
- **Health Check**: pg_isready every 10 seconds

### Server Service

- **Build**: Custom Dockerfile (Node.js 18 Alpine)
- **Container Name**: fax-server
- **Port**: 3000
- **Volume**: uploads_data (persistent file uploads)
- **Depends On**: database (waits for healthy status)
- **Health Check**: HTTP GET /health every 30 seconds

## Management Commands

### View Logs

All services:
```bash
docker-compose logs -f
```

Server only:
```bash
docker-compose logs -f server
```

Database only:
```bash
docker-compose logs -f database
```

### Stop Services

Stop without removing containers:
```bash
docker-compose stop
```

Stop and remove containers (data persists in volumes):
```bash
docker-compose down
```

### Restart Services

```bash
docker-compose restart
```

Restart single service:
```bash
docker-compose restart server
```

### Update Application

Rebuild and restart the server after code changes:

```bash
docker-compose up -d --build server
```

### Access Database

Using Docker exec:
```bash
docker exec -it fax-database psql -U postgres -d fax_tracking
```

Using psql from host (if installed):
```bash
psql -h localhost -U postgres -d fax_tracking
```

## Data Persistence

All data is stored in Docker volumes:

### List Volumes

```bash
docker volume ls | grep rfrestperf
```

### Backup Database

```bash
docker exec fax-database pg_dump -U postgres fax_tracking > backup.sql
```

### Restore Database

```bash
cat backup.sql | docker exec -i fax-database psql -U postgres -d fax_tracking
```

### Remove All Data

**Warning**: This will delete all database data and uploaded files!

```bash
docker-compose down -v
```

## Configuration

### Environment Variables

The following variables can be set in `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| FAX_API_URL | (required) | OpenText Fax API base URL |
| FAX_USERNAME | (required) | Fax API username |
| FAX_PASSWORD | (required) | Fax API password |
| BATCH_SIZE | 100 | Faxes per processing chunk |
| MAX_CONCURRENT_FAXES | 10 | Concurrent submissions |
| RETRY_ATTEMPTS | 3 | Retry count on failure |
| RETRY_DELAY_MS | 5000 | Delay between retries (ms) |

Database credentials are configured in docker-compose.yml and default to:
- Host: database (internal network)
- User: postgres
- Password: postgres
- Database: fax_tracking

### Customizing Ports

To change the exposed ports, edit `docker-compose.yml`:

```yaml
services:
  server:
    ports:
      - "8080:3000"  # Host:Container
  database:
    ports:
      - "5433:5432"  # Host:Container
```

## Production Considerations

### Security

1. **Change default passwords**: Update the database password in docker-compose.yml:
   ```yaml
   environment:
     POSTGRES_PASSWORD: your_secure_password
   ```

2. **Protect the .env file**:
   ```bash
   chmod 600 .env
   ```

3. **Don't expose database port** in production (remove ports mapping for database service)

### Performance

1. **Increase database connections**: Edit docker-compose.yml:
   ```yaml
   command: postgres -c max_connections=100
   ```

2. **Allocate more resources**: Add resource limits:
   ```yaml
   services:
     server:
       deploy:
         resources:
           limits:
             cpus: '2'
             memory: 2G
   ```

### Monitoring

View resource usage:
```bash
docker stats fax-server fax-database
```

### Backups

Set up automated backups with a cron job:

```bash
# Backup script
#!/bin/bash
BACKUP_DIR=/backups
DATE=$(date +%Y%m%d_%H%M%S)
docker exec fax-database pg_dump -U postgres fax_tracking | gzip > $BACKUP_DIR/fax_tracking_$DATE.sql.gz
find $BACKUP_DIR -name "fax_tracking_*.sql.gz" -mtime +7 -delete
```

## Troubleshooting

### Server won't start

Check logs:
```bash
docker-compose logs server
```

Common issues:
- Database not ready: Wait for database health check to pass
- Port 3000 in use: Change port mapping or stop conflicting service
- Missing .env file: Copy .env.docker to .env

### Database connection errors

Verify database is healthy:
```bash
docker-compose ps database
```

Test connection:
```bash
docker exec fax-server nc -zv database 5432
```

### Reset everything

```bash
docker-compose down -v
docker-compose up -d
```

## Integration with Grafana

To add Grafana to the stack, extend docker-compose.yml:

```yaml
services:
  grafana:
    image: grafana/grafana:latest
    container_name: fax-grafana
    restart: unless-stopped
    depends_on:
      - database
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana_data:/var/lib/grafana
      - ./grafana:/etc/grafana/provisioning/dashboards:ro
    ports:
      - "3001:3000"
    networks:
      - fax-network

volumes:
  grafana_data:
```

Then access Grafana at http://localhost:3001 (admin/admin).

## API Usage

### Submit a Batch

```bash
curl -X POST http://localhost:3000/api/batch/start \
  -H "Content-Type: application/json" \
  -d '{
    "batchName": "Test Batch",
    "faxes": [
      {
        "destinationNumber": "+1234567890",
        "recipientName": "John Doe",
        "filePath": "/path/to/document.pdf"
      }
    ]
  }'
```

### Check Batch Status

```bash
curl http://localhost:3000/api/batch/status/BATCH_ID
```

### View Recent Batches

```bash
curl http://localhost:3000/api/batches/recent
```

## Support

For issues specific to Docker deployment, check:
1. Docker logs: `docker-compose logs`
2. Container status: `docker-compose ps`
3. Network connectivity: `docker network inspect rfrestperf_fax-network`

For application issues, refer to the main README.md.
