const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const db = require('./database/db');
const BatchProcessor = require('./services/batchProcessor');
const MetricsCollector = require('./services/metricsCollector');
const logger = require('./utils/logger');
require('dotenv').config();

// Global references
let mainWindow = null;
let settingsWindow = null;
let batchProcessor = null;
let metricsCollector = null;

// Connection settings storage
let connectionSettings = {
  faxApiUrl: process.env.FAX_API_URL || '',
  faxUsername: process.env.FAX_USERNAME || '',
  faxPassword: process.env.FAX_PASSWORD || ''
};

/**
 * Create the main application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'Fax Batch Sender',
    icon: path.join(__dirname, '../assets/icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

  // Open DevTools in development mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Create the settings window
 */
function createSettingsWindow() {
  // Don't create a new window if one already exists
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 550,
    height: 500,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'Connection Settings',
    parent: mainWindow,
    modal: true,
    resizable: false
  });

  settingsWindow.loadFile(path.join(__dirname, 'renderer/settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

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

    // Set up batch processor event listeners
    batchProcessor.on('batchStarted', (data) => {
      sendToRenderer('batch-started', data);
    });

    batchProcessor.on('uploadingFile', (data) => {
      sendToRenderer('uploading-file', data);
    });

    batchProcessor.on('fileUploaded', (data) => {
      sendToRenderer('file-uploaded', data);
    });

    batchProcessor.on('chunkStarted', (data) => {
      sendToRenderer('chunk-started', data);
    });

    batchProcessor.on('chunkCompleted', (data) => {
      sendToRenderer('chunk-completed', data);
    });

    batchProcessor.on('faxSubmitted', (data) => {
      sendToRenderer('fax-submitted', data);
    });

    batchProcessor.on('faxFailed', (data) => {
      sendToRenderer('fax-failed', data);
    });

    batchProcessor.on('faxCompleted', (data) => {
      sendToRenderer('fax-completed', data);
    });

    batchProcessor.on('batchCompleted', (data) => {
      sendToRenderer('batch-completed', data);
    });

    batchProcessor.on('batchFailed', (data) => {
      sendToRenderer('batch-failed', data);
    });

    batchProcessor.on('batchError', (data) => {
      sendToRenderer('batch-error', data);
    });

    logger.log('✓ Batch processor initialized');

    // Initialize metrics collector
    metricsCollector = new MetricsCollector();
    metricsCollector.start();
    logger.log('✓ Metrics collector started');

  } catch (error) {
    logger.error('Initialization failed:', error);
    dialog.showErrorBox('Initialization Error', `Failed to initialize application: ${error.message}`);
    app.quit();
  }
}

/**
 * Send message to renderer process
 */
function sendToRenderer(channel, data) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send(channel, data);
  }
}

/**
 * IPC Handlers
 */

// Start batch
ipcMain.handle('start-batch', async (event, batchConfig) => {
  try {
    const batchId = await batchProcessor.startBatch(batchConfig);
    return { success: true, batchId };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get batch status
ipcMain.handle('get-batch-status', async (event, batchId) => {
  try {
    if (batchId) {
      const batch = await db.getBatch(batchId);
      const submissions = await db.getSubmissionsByBatch(batchId);
      return { success: true, batch, submissions };
    } else {
      const status = batchProcessor.getCurrentBatchStatus();
      return { success: true, status };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get recent batches
ipcMain.handle('get-recent-batches', async (event, limit) => {
  try {
    const batches = await db.getRecentBatches(limit || 50);
    return { success: true, batches };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get dashboard data
ipcMain.handle('get-dashboard-data', async () => {
  try {
    const data = await metricsCollector.getDashboardData();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get performance stats
ipcMain.handle('get-performance-stats', async (event, days) => {
  try {
    const stats = await metricsCollector.getPerformanceStats(days || 7);
    return { success: true, stats };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get metrics
ipcMain.handle('get-metrics', async (event, { startDate, endDate }) => {
  try {
    const metrics = await metricsCollector.getMetrics(new Date(startDate), new Date(endDate));
    return { success: true, metrics };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Select file
ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'txt', 'tif', 'tiff'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return { success: true, filePath: result.filePaths[0] };
  }
  return { success: false };
});

// Test API connection
ipcMain.handle('test-api-connection', async () => {
  try {
    logger.log('Testing connection to Fax Server...');
    const FaxApiClient = require('./api/faxApi');

    // Use saved settings if they exist, otherwise use environment variables
    const hasSettings = connectionSettings.faxApiUrl && connectionSettings.faxUsername && connectionSettings.faxPassword;
    const testClient = hasSettings ? new FaxApiClient(connectionSettings) : new FaxApiClient();

    const loginResult = await testClient.login();

    if (loginResult.success) {
      logger.log(`✓ Test connection successful to server: ${loginResult.server}`);
      await testClient.logout();
      return { success: true, message: 'Connected successfully', server: loginResult.server };
    }
    logger.error('✗ Test connection failed: Login unsuccessful');
    return { success: false, error: 'Login failed' };
  } catch (error) {
    logger.error('✗ Test connection failed:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      response: error.response?.data
    });
    return { success: false, error: error.message };
  }
});

// Open connection settings window
ipcMain.handle('open-connection-settings', async () => {
  createSettingsWindow();
  return { success: true };
});

// Get current connection settings
ipcMain.handle('get-connection-settings', async () => {
  return connectionSettings;
});

// Save connection settings
ipcMain.handle('save-connection-settings', async (event, settings) => {
  try {
    // Validate settings
    if (!settings.faxApiUrl || !settings.faxUsername || !settings.faxPassword) {
      return { success: false, error: 'All fields are required' };
    }

    // Update in-memory settings
    connectionSettings = {
      faxApiUrl: settings.faxApiUrl.trim(),
      faxUsername: settings.faxUsername.trim(),
      faxPassword: settings.faxPassword
    };

    // Update batch processor with new settings
    if (batchProcessor) {
      batchProcessor.updateConnectionSettings(connectionSettings);
    }

    logger.log('✓ Connection settings saved successfully');
    return { success: true };
  } catch (error) {
    logger.error('Error saving connection settings:', error);
    return { success: false, error: error.message };
  }
});

// Test connection with custom settings
ipcMain.handle('test-connection-with-settings', async (event, settings) => {
  try {
    logger.log('Testing connection with custom settings...');
    const FaxApiClient = require('./api/faxApi');
    const testClient = new FaxApiClient(settings);
    const loginResult = await testClient.login();

    if (loginResult.success) {
      logger.log(`✓ Test connection successful to server: ${loginResult.server}`);
      await testClient.logout();
      return { success: true, message: 'Connected successfully', server: loginResult.server };
    }
    logger.error('✗ Test connection failed: Login unsuccessful');
    return { success: false, error: 'Login failed' };
  } catch (error) {
    logger.error('✗ Test connection with custom settings failed:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      response: error.response?.data
    });
    return { success: false, error: error.message };
  }
});

/**
 * App event handlers
 */

app.on('ready', async () => {
  await initialize();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('before-quit', async () => {
  logger.log('Shutting down...');

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
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  dialog.showErrorBox('Unexpected Error', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
});
