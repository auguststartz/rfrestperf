# Fax Batch Sender

An Electron desktop application for batch fax sending via OpenText Fax REST API with PostgreSQL tracking and Grafana analytics integration.

## Features

- **Batch Processing**: Send thousands of faxes (up to 100,000) with a single submission
- **Real-time Monitoring**: Track conversion time, transmission time, and overall progress
- **PostgreSQL Storage**: Store all fax handles, metrics, and historical data
- **Grafana Integration**: Pre-built dashboards for analytics and visualization
- **Concurrent Processing**: Configurable concurrent fax submissions for optimal throughput
- **Error Handling**: Automatic retry logic and comprehensive error tracking
- **Activity History**: Complete audit trail of all fax activities

## Architecture

```
┌─────────────────┐
│  Electron App   │
│   (Frontend)    │
└────────┬────────┘
         │
         ├──────────> OpenText Fax Server (REST API)
         │                  │
         │                  ├─> Send Faxes
         │                  ├─> Track Status
         │                  └─> Get History
         │
         ├──────────> PostgreSQL Database
         │                  │
         │                  ├─> fax_batches
         │                  ├─> fax_submissions
         │                  ├─> fax_activities
         │                  └─> fax_metrics
         │
         └──────────> Grafana Dashboard
                            │
                            └─> Real-time Analytics
```

## Prerequisites

- **Node.js**: v16 or higher
- **PostgreSQL**: v12 or higher
- **OpenText Fax Server**: Version 16 EP6 or later
- **Grafana** (Optional): v9.0 or higher for dashboards

## Deployment Options

### Option 1: Docker Deployment (Recommended)

For the easiest setup with a self-contained environment including both the database and server, use Docker:

See [DOCKER.md](./DOCKER.md) for complete Docker deployment instructions.

**Quick start:**
```bash
cp .env.docker .env
# Edit .env with your FAX API credentials
docker-compose up -d
```

### Option 2: Manual Installation

For development or custom deployments, follow the manual installation steps below.

## Installation

### 1. Clone and Install Dependencies

```bash
git clone <repository-url>
cd rfrestperf
npm install
```

### 2. Configure Environment

Copy the example environment file and update with your settings:

```bash
cp .env.example .env
```

Edit `.env` file:

```env
# OpenText Fax API Configuration
FAX_API_URL=https://your-fax-server/RightFax/API
FAX_USERNAME=admin
FAX_PASSWORD=your_password

# PostgreSQL Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=fax_tracking
DB_USER=postgres
DB_PASSWORD=your_db_password

# Application Configuration
BATCH_SIZE=100                # Faxes per chunk
MAX_CONCURRENT_FAXES=10      # Concurrent submissions
RETRY_ATTEMPTS=3
RETRY_DELAY_MS=5000

# Grafana Configuration (Optional)
GRAFANA_URL=http://localhost:3000
GRAFANA_API_KEY=your_api_key
```

### 3. Setup PostgreSQL Database

Create the database:

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE fax_tracking;

# Exit
\q
```

Run migrations to create schema:

```bash
npm run db:migrate
```

This will create the following tables:
- `fax_batches` - Batch job information
- `fax_submissions` - Individual fax submission records
- `fax_activities` - Fax history and activities
- `fax_metrics` - Aggregated metrics for Grafana

### 4. Setup Grafana (Optional)

#### Install Grafana

```bash
# Ubuntu/Debian
sudo apt-get install -y grafana

# Or download from https://grafana.com/grafana/download
```

#### Configure PostgreSQL Data Source

1. Open Grafana (default: http://localhost:3000)
2. Login (default: admin/admin)
3. Go to Configuration → Data Sources
4. Add PostgreSQL data source:
   - **Name**: FaxTracking
   - **Host**: localhost:5432
   - **Database**: fax_tracking
   - **User**: postgres
   - **Password**: your_db_password
   - **SSL Mode**: disable (for local development)

#### Import Dashboard

```bash
# Use the Grafana API or UI to import the dashboard
curl -X POST http://localhost:3000/api/dashboards/db \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d @grafana/fax-dashboard.json
```

Or manually import via Grafana UI:
1. Go to Dashboards → Import
2. Upload `grafana/fax-dashboard.json`

## Usage

### Starting the Application

```bash
# Production mode
npm start

# Development mode (with DevTools)
npm run dev
```

### Sending a Batch of Faxes

1. **Open the Application**
   - Launch the Fax Batch Sender application

2. **Go to "Send Batch" Tab**
   - Enter batch name (e.g., "Monthly Newsletter - Jan 2024")
   - Enter user ID (your fax server username)
   - Select file to send (PDF, DOC, DOCX, TIF, etc.)
   - Enter destination fax number
   - Enter recipient name (optional)
   - **Enter number of faxes** (e.g., 30000 for sending 30,000 identical faxes)
   - Set priority (Normal, High, Low)
   - Add billing codes if needed

3. **Submit Batch**
   - Click "Start Batch"
   - Application automatically switches to Monitor tab

4. **Monitor Progress**
   - View real-time progress
   - See processed count, failed count, and percentage
   - View activity log for detailed status updates
   - Conversion and transmission times are tracked automatically

### Viewing History

1. Go to "History" tab
2. View all past batches with status
3. Click "View" on any batch to see detailed information
4. Data includes:
   - Batch statistics
   - Success/failure rates
   - Processing times
   - Individual submission status

### Dashboard Analytics

1. Go to "Dashboard" tab for quick overview
2. Open Grafana for detailed analytics:
   - Click "Open Grafana Dashboard"
   - View real-time metrics
   - Analyze performance trends
   - Monitor conversion and transmission times

## Database Schema

### fax_batches
Stores batch job information:
- Batch ID, name, user
- Total faxes, completed, failed
- Status and timestamps
- File information

### fax_submissions
Stores individual fax records:
- Fax handle (SendJob ID/Document ID)
- Destination and recipient
- Status and condition
- **Timing metrics**:
  - `conversion_duration` - Time to convert document (ms)
  - `transmission_duration` - Time to transmit fax (ms)
  - `total_duration` - Total processing time (ms)
- Error messages and retry count
- Billing codes

### fax_activities
Stores fax history:
- Activity messages from API
- Timestamps and user information
- Diagnostic information
- Linked to submissions

### fax_metrics
Aggregated metrics by date and hour:
- Total submitted, succeeded, failed
- Average processing times
- Max processing times
- Total pages and batches

## API Integration

The application uses the OpenText Fax Web API as documented in the provided PDF. Key operations:

### Authentication
```javascript
POST /api/login
Authorization: Basic <base64-encoded-credentials>
```

Returns session cookie for subsequent requests.

### Upload Attachment
```javascript
POST /api/Attachments
Content-Type: multipart/form-data
```

Returns attachment URL for use in SendJob.

### Create Send Job
```javascript
POST /api/SendJobs
{
  "Recipients": [{"Name": "...", "Destination": "..."}],
  "AttachmentUrls": ["..."],
  "Priority": "Normal"
}
```

Returns SendJob ID (fax handle).

### Monitor Progress
```javascript
GET /api/SendJobs/{sendJobId}
GET /api/Documents?filter=job&jobid={sendJobId}
GET /api/DocumentActivities?documentId={documentId}
```

The application polls these endpoints to track:
- Conversion progress
- Transmission status
- Completion or failure
- Detailed timing metrics

## Grafana Dashboards

The included dashboard provides:

### Real-time Metrics
- Total faxes processed (24h)
- Success rate percentage
- Average processing time
- Failed fax count

### Time Series Charts
- Faxes over time (submitted, succeeded, failed)
- Processing time breakdown (conversion vs transmission)

### Tables
- Real-time fax activity (last hour)
- Batch performance statistics

### Gauges and Bar Charts
- Hourly throughput
- Performance percentiles (P50, P95, P99)

## Performance Tuning

### Concurrent Processing
Adjust in `.env`:
```env
MAX_CONCURRENT_FAXES=10  # Increase for more throughput
BATCH_SIZE=100           # Increase for larger chunks
```

### Database Optimization
```sql
-- Add indexes if needed
CREATE INDEX idx_custom ON fax_submissions(field_name);

-- Vacuum regularly
VACUUM ANALYZE fax_submissions;
```

### Monitoring Resource Usage
- Check PostgreSQL connection pool size
- Monitor Electron memory usage
- Track fax server load

## Troubleshooting

### Connection Issues
```bash
# Test API connection
npm start
# Click "Test Connection" button in app
```

### Database Issues
```bash
# Reset database
psql -U postgres -d fax_tracking -f src/database/schema.sql

# Or re-run migration
npm run db:migrate
```

### Common Errors

**"No session cookie received"**
- Check API credentials in `.env`
- Verify fax server is accessible
- Check firewall settings

**"Database connection failed"**
- Verify PostgreSQL is running
- Check database credentials
- Ensure database exists

**"File upload failed"**
- Check file permissions
- Verify file format is supported
- Check file size limits

## Development

### Project Structure
```
rfrestperf/
├── src/
│   ├── main.js              # Electron main process
│   ├── api/
│   │   └── faxApi.js        # OpenText Fax API client
│   ├── database/
│   │   ├── db.js            # Database connection & queries
│   │   ├── schema.sql       # Database schema
│   │   └── migrate.js       # Migration script
│   ├── services/
│   │   ├── batchProcessor.js    # Batch processing engine
│   │   └── metricsCollector.js  # Metrics aggregation
│   └── renderer/
│       ├── index.html       # Main UI
│       ├── renderer.js      # Frontend logic
│       └── styles.css       # UI styles
├── grafana/
│   └── fax-dashboard.json   # Grafana dashboard config
├── package.json
├── .env.example
└── README.md
```

### Building for Production

```bash
npm run build
```

Creates distributable packages in `dist/` folder.

## Security Considerations

- Store API credentials securely (use `.env`, never commit)
- Use HTTPS for fax server connections
- Implement database access controls
- Regular security updates for dependencies
- Enable PostgreSQL SSL in production

## License

MIT

## Support

For issues or questions:
1. Check the OpenText Fax API documentation (included PDF)
2. Review database logs: `SELECT * FROM fax_activities WHERE is_diagnostic = true`
3. Check application logs in Electron DevTools console

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

---

**Note**: This application is designed for use with OpenText Fax (formerly RightFax) version 16 Enhancement Pack 6 or later. Refer to the included "OpenText Fax CE 24.4 - Web API SDK Installation and Quick Start Guide.pdf" for detailed API documentation.
