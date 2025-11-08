const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// PostgreSQL connection pool
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'fax_tracking',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test connection
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

/**
 * Execute a query
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise}
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

/**
 * Get a client from the pool for transactions
 * @returns {Promise}
 */
async function getClient() {
  return await pool.connect();
}

/**
 * Initialize database schema
 * @returns {Promise<boolean>}
 */
async function initializeDatabase() {
  const client = await getClient();
  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    await client.query('BEGIN');

    // Split schema into individual statements
    // Handle function definitions that use $$ delimiters and contain semicolons
    const statements = [];
    let currentStatement = '';
    let inDollarQuote = false;

    const lines = schema.split('\n');
    for (const line of lines) {
      // Skip comment-only lines
      if (line.trim().startsWith('--')) {
        continue;
      }

      // Track $$ delimiters for function definitions
      if (line.includes('$$')) {
        inDollarQuote = !inDollarQuote;
      }

      currentStatement += line + '\n';

      // Split on semicolons only when not inside $$ delimiters
      if (line.includes(';') && !inDollarQuote) {
        const trimmed = currentStatement.trim();
        if (trimmed.length > 0) {
          statements.push(trimmed);
        }
        currentStatement = '';
      }
    }

    // Add any remaining statement
    const trimmed = currentStatement.trim();
    if (trimmed.length > 0) {
      statements.push(trimmed);
    }

    // Execute each statement individually
    for (const statement of statements) {
      if (statement) {
        await client.query(statement);
      }
    }

    await client.query('COMMIT');

    console.log('Database schema initialized successfully');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error initializing database:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Create a new fax batch
 * @param {Object} batchData - Batch information
 * @returns {Promise<number>} - Batch ID
 */
async function createBatch(batchData) {
  const { batch_name, user_id, total_faxes, file_path, file_size, destination_number } = batchData;

  const result = await query(
    `INSERT INTO fax_batches (batch_name, user_id, total_faxes, file_path, file_size, destination_number, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     RETURNING id`,
    [batch_name, user_id, total_faxes, file_path, file_size, destination_number]
  );

  return result.rows[0].id;
}

/**
 * Update batch status
 * @param {number} batchId - Batch ID
 * @param {Object} updates - Fields to update
 * @returns {Promise}
 */
async function updateBatch(batchId, updates) {
  const fields = [];
  const values = [];
  let paramCount = 1;

  Object.entries(updates).forEach(([key, value]) => {
    fields.push(`${key} = $${paramCount}`);
    values.push(value);
    paramCount++;
  });

  values.push(batchId);

  const sql = `UPDATE fax_batches SET ${fields.join(', ')} WHERE id = $${paramCount}`;
  await query(sql, values);
}

/**
 * Create a fax submission record
 * @param {Object} submissionData - Submission information
 * @returns {Promise<number>} - Submission ID
 */
async function createSubmission(submissionData) {
  const {
    batch_id,
    fax_handle,
    send_job_id,
    document_id,
    destination_number,
    recipient_name,
    status,
    priority,
    billing_code1,
    billing_code2
  } = submissionData;

  const result = await query(
    `INSERT INTO fax_submissions
     (batch_id, fax_handle, send_job_id, document_id, destination_number, recipient_name,
      status, priority, billing_code1, billing_code2)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [batch_id, fax_handle, send_job_id, document_id, destination_number, recipient_name,
     status, priority, billing_code1, billing_code2]
  );

  return result.rows[0].id;
}

/**
 * Update submission with timing and status information
 * @param {string} faxHandle - Fax handle (SendJob ID or Document ID)
 * @param {Object} updates - Fields to update
 * @returns {Promise}
 */
async function updateSubmission(faxHandle, updates) {
  const fields = [];
  const values = [];
  let paramCount = 1;

  Object.entries(updates).forEach(([key, value]) => {
    fields.push(`${key} = $${paramCount}`);
    values.push(value);
    paramCount++;
  });

  values.push(faxHandle);

  const sql = `UPDATE fax_submissions SET ${fields.join(', ')} WHERE fax_handle = $${paramCount}`;
  await query(sql, values);
}

/**
 * Store fax activity/history
 * @param {number} submissionId - Submission ID
 * @param {Object} activity - Activity data
 * @returns {Promise}
 */
async function createActivity(submissionId, activity) {
  const {
    activity_id,
    message,
    timestamp,
    user_id,
    user_display_name,
    condition,
    status,
    is_diagnostic
  } = activity;

  await query(
    `INSERT INTO fax_activities
     (submission_id, activity_id, message, timestamp, user_id, user_display_name,
      condition, status, is_diagnostic)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [submissionId, activity_id, message, timestamp, user_id, user_display_name,
     condition, status, is_diagnostic]
  );
}

/**
 * Update or insert daily metrics
 * @param {Object} metrics - Metrics data
 * @returns {Promise}
 */
async function updateMetrics(metrics) {
  const {
    date,
    hour,
    total_submitted,
    total_succeeded,
    total_failed,
    total_cancelled,
    avg_conversion_time,
    avg_transmission_time,
    avg_total_time,
    max_conversion_time,
    max_transmission_time,
    total_pages,
    total_batches
  } = metrics;

  await query(
    `INSERT INTO fax_metrics
     (date, hour, total_submitted, total_succeeded, total_failed, total_cancelled,
      avg_conversion_time, avg_transmission_time, avg_total_time,
      max_conversion_time, max_transmission_time, total_pages, total_batches)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (date, hour) DO UPDATE SET
       total_submitted = fax_metrics.total_submitted + EXCLUDED.total_submitted,
       total_succeeded = fax_metrics.total_succeeded + EXCLUDED.total_succeeded,
       total_failed = fax_metrics.total_failed + EXCLUDED.total_failed,
       total_cancelled = fax_metrics.total_cancelled + EXCLUDED.total_cancelled,
       avg_conversion_time = (fax_metrics.avg_conversion_time + EXCLUDED.avg_conversion_time) / 2,
       avg_transmission_time = (fax_metrics.avg_transmission_time + EXCLUDED.avg_transmission_time) / 2,
       avg_total_time = (fax_metrics.avg_total_time + EXCLUDED.avg_total_time) / 2,
       max_conversion_time = GREATEST(fax_metrics.max_conversion_time, EXCLUDED.max_conversion_time),
       max_transmission_time = GREATEST(fax_metrics.max_transmission_time, EXCLUDED.max_transmission_time),
       total_pages = fax_metrics.total_pages + EXCLUDED.total_pages,
       total_batches = fax_metrics.total_batches + EXCLUDED.total_batches`,
    [date, hour, total_submitted, total_succeeded, total_failed, total_cancelled,
     avg_conversion_time, avg_transmission_time, avg_total_time,
     max_conversion_time, max_transmission_time, total_pages, total_batches]
  );
}

/**
 * Get batch by ID
 * @param {number} batchId - Batch ID
 * @returns {Promise<Object>}
 */
async function getBatch(batchId) {
  const result = await query('SELECT * FROM fax_batches WHERE id = $1', [batchId]);
  return result.rows[0];
}

/**
 * Get submission by fax handle
 * @param {string} faxHandle - Fax handle
 * @returns {Promise<Object>}
 */
async function getSubmissionByHandle(faxHandle) {
  const result = await query('SELECT * FROM fax_submissions WHERE fax_handle = $1', [faxHandle]);
  return result.rows[0];
}

/**
 * Get all submissions for a batch
 * @param {number} batchId - Batch ID
 * @returns {Promise<Array>}
 */
async function getSubmissionsByBatch(batchId) {
  const result = await query(
    'SELECT * FROM fax_submissions WHERE batch_id = $1 ORDER BY created_at DESC',
    [batchId]
  );
  return result.rows;
}

/**
 * Get recent batches
 * @param {number} limit - Number of batches to retrieve
 * @returns {Promise<Array>}
 */
async function getRecentBatches(limit = 50) {
  const result = await query(
    'SELECT * FROM fax_batches ORDER BY created_at DESC LIMIT $1',
    [limit]
  );
  return result.rows;
}

/**
 * Close database connection
 */
async function close() {
  await pool.end();
}

module.exports = {
  query,
  getClient,
  initializeDatabase,
  createBatch,
  updateBatch,
  createSubmission,
  updateSubmission,
  createActivity,
  updateMetrics,
  getBatch,
  getSubmissionByHandle,
  getSubmissionsByBatch,
  getRecentBatches,
  close
};
