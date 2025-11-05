# Quick Start Guide

Get up and running with the Fax Batch Sender in 5 minutes!

## Prerequisites Check

- [ ] Node.js v16+ installed (`node --version`)
- [ ] PostgreSQL 12+ installed (`psql --version`)
- [ ] OpenText Fax Server accessible
- [ ] Fax server credentials available

## 5-Minute Setup

### 1. Install (1 minute)

```bash
cd rfrestperf
npm install
```

### 2. Configure (2 minutes)

Create `.env` file:

```bash
cp .env.example .env
```

Edit `.env` with your settings:
```env
FAX_API_URL=https://your-fax-server/RightFax/API
FAX_USERNAME=admin
FAX_PASSWORD=password

DB_HOST=localhost
DB_PORT=5432
DB_NAME=fax_tracking
DB_USER=postgres
DB_PASSWORD=postgres
```

### 3. Setup Database (1 minute)

```bash
# Create database
createdb fax_tracking

# Run migrations
npm run db:migrate
```

### 4. Start Application (1 minute)

```bash
npm start
```

## First Batch

### Send Your First Fax

1. Click **Test Connection** to verify API access
2. Go to **Send Batch** tab
3. Fill in the form:
   - **Batch Name**: "Test Batch"
   - **User ID**: Your fax username
   - **File**: Click Browse and select a PDF
   - **Destination**: Enter a fax number
   - **Number of Faxes**: Start with 1 for testing
4. Click **Start Batch**
5. Watch progress in the **Monitor** tab

### What Happens?

1. **Upload**: File is uploaded to fax server
2. **Submit**: Fax job is created
3. **Convert**: Document is converted to fax format (tracked)
4. **Transmit**: Fax is sent (tracked)
5. **Store**: All metrics saved to PostgreSQL
6. **Complete**: View results in History tab

## Understanding the Batch Process

### Example: Sending 30,000 Faxes

When you enter "30000" in the "Number of Faxes" field:

1. **Single Upload**: File is uploaded once
2. **Batch Processing**:
   - Split into chunks (default: 100 faxes per chunk)
   - Each chunk processes concurrently (default: 10 at a time)
3. **Progress Tracking**: Real-time updates every fax
4. **Metrics Collection**:
   - Conversion time per fax
   - Transmission time per fax
   - Total duration
5. **Database Storage**: All handles and metrics stored
6. **Completion**: Full history available for analysis

### Time Estimates

For 30,000 faxes (rough estimates):

- **File Upload**: ~10-30 seconds (one-time)
- **Per Fax Processing**:
  - Conversion: ~2-5 seconds
  - Transmission: ~30-60 seconds (varies by page count)
- **Total Time**: ~8-12 hours for 30,000 faxes
  - With 10 concurrent: ~10 hours
  - With 20 concurrent: ~5 hours

## Monitoring Your Batch

### Real-time Monitoring

The **Monitor** tab shows:
- Total faxes in batch
- Processed count (live updates)
- Failed count
- Progress percentage
- Activity log with timestamps

### Database Queries

Check progress directly in PostgreSQL:

```sql
-- Get batch status
SELECT * FROM fax_batches WHERE id = 1;

-- Count successful faxes
SELECT COUNT(*) FROM fax_submissions
WHERE batch_id = 1 AND status = 'sent';

-- Average processing time
SELECT
  AVG(conversion_duration) / 1000 as avg_conversion_sec,
  AVG(transmission_duration) / 1000 as avg_transmission_sec
FROM fax_submissions
WHERE batch_id = 1 AND status = 'sent';
```

## Viewing Results

### History Tab

- Lists all batches
- Shows success/failure counts
- Click "View" for detailed batch info
- See processing times

### Dashboard Tab

- Today's statistics
- Performance metrics (last 7 days)
- Average conversion times
- Average transmission times

### Grafana (Advanced)

1. Open Grafana: http://localhost:3000
2. View pre-built dashboard
3. Analyze trends over time
4. Create custom queries

## Common Use Cases

### Case 1: Marketing Campaign (10,000 faxes)

```
Batch Name: "Q1 Promotion"
User ID: marketing_user
File: promotion.pdf
Destination: 555-1234 (will be sent 10,000 times)
Number: 10000
Priority: Normal
Billing Code 1: MARKETING
Billing Code 2: Q1-2024
```

### Case 2: Urgent Announcement (100 faxes)

```
Batch Name: "Urgent - System Maintenance"
User ID: admin
File: maintenance_notice.pdf
Destination: 555-5678
Number: 100
Priority: High
Billing Code 1: IT
Billing Code 2: URGENT
```

### Case 3: Performance Testing (1,000 faxes)

```
Batch Name: "Load Test - Evening"
User ID: test_user
File: test_document.pdf
Destination: 555-9999
Number: 1000
Priority: Low
```

## Best Practices

### Before Large Batches

1. **Test Small**: Send 1-10 faxes first
2. **Verify Destination**: Ensure fax number is correct
3. **Check File**: Verify file opens and displays correctly
4. **Monitor Resources**: Ensure server has capacity
5. **Schedule Off-Peak**: Run large batches during low-traffic hours

### During Processing

1. **Monitor Progress**: Watch the Monitor tab
2. **Check Activity Log**: Look for errors
3. **Database Health**: Monitor PostgreSQL connections
4. **Server Load**: Check fax server performance

### After Completion

1. **Review History**: Check success rate
2. **Analyze Metrics**: Look at conversion/transmission times
3. **Export Data**: Use Grafana for reports
4. **Archive Batches**: Clean up old data if needed

## Troubleshooting Quick Fixes

### Issue: "Login Failed"
```bash
# Test connection manually
curl -u username:password https://your-fax-server/RightFax/API/login
```

### Issue: "Database Connection Error"
```bash
# Test database
psql -U postgres -d fax_tracking -c "SELECT 1"
```

### Issue: "File Too Large"
- Check file size
- Try compressing PDF
- Split into multiple batches

### Issue: "Slow Processing"
- Increase `MAX_CONCURRENT_FAXES` in `.env`
- Check network latency
- Verify fax server isn't overloaded

## Next Steps

1. **Configure Grafana** for advanced analytics
2. **Set up Monitoring** alerts for failures
3. **Create Reports** using database views
4. **Optimize Settings** based on your server capacity
5. **Automate Scheduling** for recurring batches

## Getting Help

1. **Check Logs**: View Activity Log in Monitor tab
2. **Database Diagnostics**:
   ```sql
   SELECT * FROM fax_activities WHERE is_diagnostic = true ORDER BY timestamp DESC LIMIT 20;
   ```
3. **API Documentation**: See `OpenText Fax CE 24.4 - Web API SDK Installation and Quick Start Guide.pdf`
4. **README**: Full documentation in `README.md`

## Success Indicators

You're ready for production when:
- [x] Test batch of 10 faxes succeeds
- [x] Database stores all metrics correctly
- [x] Monitor tab shows real-time updates
- [x] History tab displays batch information
- [x] Dashboard shows today's statistics
- [x] No errors in activity log

---

**Ready to send 30,000 faxes?** Just increase the number and hit Start Batch! 🚀

For detailed documentation, see [README.md](README.md)
