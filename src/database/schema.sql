-- Fax Batch Tracking Database Schema

-- Create tables
CREATE TABLE IF NOT EXISTS fax_batches (
    id SERIAL PRIMARY KEY,
    batch_name VARCHAR(255) NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    total_faxes INTEGER NOT NULL,
    completed_faxes INTEGER DEFAULT 0,
    failed_faxes INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'pending', -- pending, processing, completed, failed
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    file_path TEXT,
    file_size BIGINT,
    destination_number VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS fax_submissions (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER REFERENCES fax_batches(id) ON DELETE CASCADE,
    fax_handle VARCHAR(255) UNIQUE, -- Handle from API (SendJob ID or Document ID)
    send_job_id VARCHAR(100),
    document_id VARCHAR(100),
    destination_number VARCHAR(50) NOT NULL,
    recipient_name VARCHAR(255),
    status VARCHAR(50) DEFAULT 'queued', -- queued, converting, sending, sent, failed, cancelled
    condition VARCHAR(50), -- Processing, Succeeded, Failed, Canceled
    priority VARCHAR(20) DEFAULT 'Normal',
    page_count INTEGER,

    -- Timing metrics
    queued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    conversion_started_at TIMESTAMP,
    conversion_completed_at TIMESTAMP,
    transmission_started_at TIMESTAMP,
    transmission_completed_at TIMESTAMP,

    -- Duration calculations (in milliseconds)
    conversion_duration INTEGER,
    transmission_duration INTEGER,
    total_duration INTEGER,

    -- Additional metadata
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    billing_code1 VARCHAR(100),
    billing_code2 VARCHAR(100),
    csid VARCHAR(100),
    unique_id VARCHAR(100),

    -- API response data
    api_response JSONB,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fax_activities (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER REFERENCES fax_submissions(id) ON DELETE CASCADE,
    activity_id VARCHAR(100),
    message TEXT,
    timestamp TIMESTAMP,
    user_id VARCHAR(100),
    user_display_name VARCHAR(255),
    condition VARCHAR(50),
    status VARCHAR(50),
    is_diagnostic BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fax_metrics (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    hour INTEGER, -- 0-23 for hourly metrics

    -- Counts
    total_submitted INTEGER DEFAULT 0,
    total_succeeded INTEGER DEFAULT 0,
    total_failed INTEGER DEFAULT 0,
    total_cancelled INTEGER DEFAULT 0,

    -- Performance metrics (in milliseconds)
    avg_conversion_time INTEGER,
    avg_transmission_time INTEGER,
    avg_total_time INTEGER,
    max_conversion_time INTEGER,
    max_transmission_time INTEGER,

    -- Volume metrics
    total_pages INTEGER DEFAULT 0,
    total_batches INTEGER DEFAULT 0,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(date, hour)
);

-- Create indexes for performance
CREATE INDEX idx_fax_batches_status ON fax_batches(status);
CREATE INDEX idx_fax_batches_created_at ON fax_batches(created_at);
CREATE INDEX idx_fax_submissions_batch_id ON fax_submissions(batch_id);
CREATE INDEX idx_fax_submissions_status ON fax_submissions(status);
CREATE INDEX idx_fax_submissions_fax_handle ON fax_submissions(fax_handle);
CREATE INDEX idx_fax_submissions_document_id ON fax_submissions(document_id);
CREATE INDEX idx_fax_submissions_created_at ON fax_submissions(created_at);
CREATE INDEX idx_fax_activities_submission_id ON fax_activities(submission_id);
CREATE INDEX idx_fax_activities_timestamp ON fax_activities(timestamp);
CREATE INDEX idx_fax_metrics_date ON fax_metrics(date);
CREATE INDEX idx_fax_metrics_date_hour ON fax_metrics(date, hour);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
CREATE TRIGGER update_fax_submissions_updated_at
    BEFORE UPDATE ON fax_submissions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_fax_metrics_updated_at
    BEFORE UPDATE ON fax_metrics
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create views for Grafana
CREATE OR REPLACE VIEW v_fax_dashboard AS
SELECT
    DATE(created_at) as date,
    COUNT(*) as total_faxes,
    SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as successful_faxes,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_faxes,
    AVG(conversion_duration) as avg_conversion_time,
    AVG(transmission_duration) as avg_transmission_time,
    AVG(total_duration) as avg_total_time,
    SUM(page_count) as total_pages
FROM fax_submissions
GROUP BY DATE(created_at)
ORDER BY date DESC;

CREATE OR REPLACE VIEW v_fax_realtime AS
SELECT
    fs.id,
    fs.fax_handle,
    fs.destination_number,
    fs.status,
    fs.condition,
    fs.page_count,
    fs.conversion_duration,
    fs.transmission_duration,
    fs.total_duration,
    fs.created_at,
    fs.updated_at,
    fb.batch_name,
    fb.user_id
FROM fax_submissions fs
LEFT JOIN fax_batches fb ON fs.batch_id = fb.id
WHERE fs.created_at > NOW() - INTERVAL '24 hours'
ORDER BY fs.created_at DESC;

CREATE OR REPLACE VIEW v_batch_performance AS
SELECT
    fb.id,
    fb.batch_name,
    fb.user_id,
    fb.total_faxes,
    fb.completed_faxes,
    fb.failed_faxes,
    fb.status,
    fb.created_at,
    fb.started_at,
    fb.completed_at,
    EXTRACT(EPOCH FROM (fb.completed_at - fb.started_at)) as batch_duration_seconds,
    AVG(fs.conversion_duration) as avg_conversion_ms,
    AVG(fs.transmission_duration) as avg_transmission_ms,
    AVG(fs.total_duration) as avg_total_ms
FROM fax_batches fb
LEFT JOIN fax_submissions fs ON fb.id = fs.batch_id
GROUP BY fb.id, fb.batch_name, fb.user_id, fb.total_faxes, fb.completed_faxes,
         fb.failed_faxes, fb.status, fb.created_at, fb.started_at, fb.completed_at
ORDER BY fb.created_at DESC;
