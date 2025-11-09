const express = require('express');
const path = require('path');
const multer = require('multer');
const db = require('./database/db');
const BatchProcessor = require('./services/batchProcessor');
const MetricsCollector = require('./services/metricsCollector');
const logger = require('./utils/logger');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Global references
let batchProcessor = null;
let metricsCollector = null;
const activeBatchClients = new Set();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'renderer')));

// Configure multer for file uploads
const upload = multer({
  dest: '/tmp/uploads/',
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

/**
 * Initialize application
 */
async function initialize() {
  try {
    logger.log('Initializing application...');

    // Initialize database
    await db.initializeDatabase();
    logger.log('✓ Database initialized');

    // Initialize batch processor
    batchProcessor = new BatchProcessor();

    // Set up batch processor event listeners for real-time updates
    const events = [
      'batchStarted', 'uploadingFile', 'fileUploaded', 'chunkStarted',
      'chunkCompleted', 'faxSubmitted', 'faxFailed', 'faxCompleted',
      'batchCompleted', 'batchFailed', 'batchError'
    ];

    events.forEach(eventName => {
      batchProcessor.on(eventName, (data) => {
        // Broadcast to all connected SSE clients
        broadcastToClients(eventName, data);
      });
    });

    logger.log('✓ Batch processor initialized');

    // Initialize metrics collector
    metricsCollector = new MetricsCollector();
    metricsCollector.start();
    logger.log('✓ Metrics collector started');

  } catch (error) {
    logger.error('Initialization failed:', error);
    process.exit(1);
  }
}

/**
 * Broadcast event to all connected SSE clients
 */
function broadcastToClients(event, data) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  activeBatchClients.forEach(client => {
    try {
      client.write(message);
    } catch (error) {
      logger.error('Error broadcasting to client:', error);
      activeBatchClients.delete(client);
    }
  });
}

/**
 * API Routes
 */

// Start batch
app.post('/api/batch/start', upload.single('file'), async (req, res) => {
  try {
    const batchConfig = {
      batchName: req.body.batchName,
      userId: req.body.userId,
      filePath: req.file ? req.file.path : req.body.filePath,
      destinationNumber: req.body.destinationNumber,
      recipientName: req.body.recipientName,
      totalCount: parseInt(req.body.totalCount),
      priority: req.body.priority,
      billingCode1: req.body.billingCode1,
      billingCode2: req.body.billingCode2
    };

    const batchId = await batchProcessor.startBatch(batchConfig);
    res.json({ success: true, batchId });
  } catch (error) {
    logger.error('Error starting batch:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get batch status
app.get('/api/batch/status/:batchId?', async (req, res) => {
  try {
    const { batchId } = req.params;

    if (batchId) {
      const batch = await db.getBatch(batchId);
      const submissions = await db.getSubmissionsByBatch(batchId);
      res.json({ success: true, batch, submissions });
    } else {
      const status = batchProcessor.getCurrentBatchStatus();
      res.json({ success: true, status });
    }
  } catch (error) {
    logger.error('Error getting batch status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get recent batches
app.get('/api/batches/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const batches = await db.getRecentBatches(limit);
    res.json({ success: true, batches });
  } catch (error) {
    logger.error('Error getting recent batches:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get dashboard data
app.get('/api/dashboard', async (req, res) => {
  try {
    const data = await metricsCollector.getDashboardData();
    res.json({ success: true, data });
  } catch (error) {
    logger.error('Error getting dashboard data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get performance stats
app.get('/api/performance/stats', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const stats = await metricsCollector.getPerformanceStats(days);
    res.json({ success: true, stats });
  } catch (error) {
    logger.error('Error getting performance stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get metrics
app.get('/api/metrics', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const metrics = await metricsCollector.getMetrics(
      new Date(startDate),
      new Date(endDate)
    );
    res.json({ success: true, metrics });
  } catch (error) {
    logger.error('Error getting metrics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test API connection
app.get('/api/test-connection', async (req, res) => {
  try {
    const FaxApiClient = require('./api/faxApi');
    const testClient = new FaxApiClient();
    const loginResult = await testClient.login();

    if (loginResult.success) {
      await testClient.logout();
      res.json({
        success: true,
        message: 'Connected successfully',
        server: loginResult.server
      });
    } else {
      res.status(500).json({ success: false, error: 'Login failed' });
    }
  } catch (error) {
    logger.error('Error testing connection:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Server-Sent Events endpoint for real-time updates
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Add this client to active clients
  activeBatchClients.add(res);

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  // Remove client on disconnect
  req.on('close', () => {
    activeBatchClients.delete(res);
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'renderer', 'index.html'));
});

/**
 * Error handler
 */
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

/**
 * Start server
 */
async function startServer() {
  await initialize();

  app.listen(PORT, '0.0.0.0', () => {
    logger.log(`
╔═══════════════════════════════════════════════════╗
║                                                   ║
║       📠  Fax Batch Sender - Web Edition         ║
║                                                   ║
║       Server running on port ${PORT}                 ║
║       Access at: http://localhost:${PORT}            ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
    `);
  });
}

/**
 * Graceful shutdown
 */
async function shutdown() {
  logger.log('\nShutting down gracefully...');

  // Close all SSE connections
  activeBatchClients.forEach(client => {
    try {
      client.end();
    } catch (error) {
      logger.error('Error closing client connection:', error);
    }
  });
  activeBatchClients.clear();

  // Stop batch processor
  if (batchProcessor) {
    await batchProcessor.stop();
  }

  // Stop metrics collector
  if (metricsCollector) {
    metricsCollector.stop();
  }

  // Close database connection
  await db.close();

  logger.log('✓ Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
});

// Start the server
startServer().catch(error => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});
