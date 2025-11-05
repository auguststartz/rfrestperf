const { ipcRenderer } = require('electron');

// State
let currentBatchId = null;
let updateInterval = null;

/**
 * Initialize the application
 */
function initialize() {
  setupEventListeners();
  setupIpcListeners();
  loadRecentBatches();

  // Set Grafana link
  const grafanaUrl = process.env.GRAFANA_URL || 'http://localhost:3000';
  document.getElementById('grafanaLink').href = grafanaUrl;
}

/**
 * Setup UI event listeners
 */
function setupEventListeners() {
  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Batch form submission
  document.getElementById('batchForm').addEventListener('submit', handleBatchSubmit);

  // File selection
  document.getElementById('selectFileBtn').addEventListener('click', handleFileSelect);

  // Test connection
  document.getElementById('testConnectionBtn').addEventListener('click', testConnection);

  // Refresh buttons
  document.getElementById('refreshHistoryBtn').addEventListener('click', loadRecentBatches);
  document.getElementById('refreshDashboardBtn').addEventListener('click', loadDashboardData);
}

/**
 * Setup IPC listeners
 */
function setupIpcListeners() {
  ipcRenderer.on('batch-started', (event, data) => {
    logActivity(`Batch started: ${data.batchId}, Total: ${data.totalCount}`);
    currentBatchId = data.batchId;
    switchTab('monitor');
  });

  ipcRenderer.on('uploading-file', (event, data) => {
    logActivity('Uploading file to server...');
  });

  ipcRenderer.on('file-uploaded', (event, data) => {
    logActivity('✓ File uploaded successfully');
  });

  ipcRenderer.on('chunk-started', (event, data) => {
    logActivity(`Processing chunk ${data.chunkIndex}/${data.totalChunks} (${data.chunkSize} faxes)`);
  });

  ipcRenderer.on('chunk-completed', (event, data) => {
    logActivity(`✓ Chunk ${data.chunkIndex}/${data.totalChunks} completed`);
  });

  ipcRenderer.on('fax-submitted', (event, data) => {
    updateProgress(data);
  });

  ipcRenderer.on('fax-failed', (event, data) => {
    logActivity(`✗ Fax ${data.submissionNumber} failed: ${data.error}`, 'error');
  });

  ipcRenderer.on('fax-completed', (event, data) => {
    const duration = data.duration ? `(${(data.duration / 1000).toFixed(1)}s)` : '';
    logActivity(`✓ Fax completed: ${data.faxHandle} - ${data.status} ${duration}`, 'success');
  });

  ipcRenderer.on('batch-completed', (event, data) => {
    logActivity(`✓✓✓ Batch completed! Success: ${data.successCount}, Failed: ${data.failedCount}`, 'success');
    setTimeout(() => {
      loadRecentBatches();
      loadDashboardData();
    }, 1000);
  });

  ipcRenderer.on('batch-failed', (event, data) => {
    logActivity(`✗✗✗ Batch failed: ${data.error}`, 'error');
  });

  ipcRenderer.on('batch-error', (event, data) => {
    logActivity(`✗ Error: ${data.error}`, 'error');
  });
}

/**
 * Switch tabs
 */
function switchTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  // Update tab content
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `${tabName}-tab`);
  });

  // Load data for specific tabs
  if (tabName === 'history') {
    loadRecentBatches();
  } else if (tabName === 'dashboard') {
    loadDashboardData();
  } else if (tabName === 'monitor') {
    updateMonitorTab();
  }
}

/**
 * Handle batch form submission
 */
async function handleBatchSubmit(e) {
  e.preventDefault();

  const batchConfig = {
    batchName: document.getElementById('batchName').value,
    userId: document.getElementById('userId').value,
    filePath: document.getElementById('filePath').value,
    destinationNumber: document.getElementById('destinationNumber').value,
    recipientName: document.getElementById('recipientName').value,
    totalCount: parseInt(document.getElementById('totalCount').value),
    priority: document.getElementById('priority').value,
    billingCode1: document.getElementById('billingCode1').value,
    billingCode2: document.getElementById('billingCode2').value
  };

  // Validation
  if (!batchConfig.filePath) {
    alert('Please select a file');
    return;
  }

  if (batchConfig.totalCount < 1 || batchConfig.totalCount > 100000) {
    alert('Total count must be between 1 and 100,000');
    return;
  }

  try {
    // Disable form
    document.getElementById('batchForm').querySelectorAll('input, select, button').forEach(el => {
      el.disabled = true;
    });

    const result = await ipcRenderer.invoke('start-batch', batchConfig);

    if (result.success) {
      currentBatchId = result.batchId;
      // Form will be re-enabled after batch completes
    } else {
      alert(`Failed to start batch: ${result.error}`);
      // Re-enable form
      document.getElementById('batchForm').querySelectorAll('input, select, button').forEach(el => {
        el.disabled = false;
      });
    }
  } catch (error) {
    alert(`Error: ${error.message}`);
    document.getElementById('batchForm').querySelectorAll('input, select, button').forEach(el => {
      el.disabled = false;
    });
  }
}

/**
 * Handle file selection
 */
async function handleFileSelect() {
  const result = await ipcRenderer.invoke('select-file');

  if (result.success) {
    document.getElementById('filePath').value = result.filePath;
  }
}

/**
 * Test API connection
 */
async function testConnection() {
  const btn = document.getElementById('testConnectionBtn');
  const status = document.getElementById('connectionStatus');

  btn.disabled = true;
  btn.textContent = 'Testing...';
  status.className = 'status-indicator status-warning';

  try {
    const result = await ipcRenderer.invoke('test-api-connection');

    if (result.success) {
      status.className = 'status-indicator status-success';
      alert(`✓ Connected successfully to ${result.server}`);
    } else {
      status.className = 'status-indicator status-error';
      alert(`✗ Connection failed: ${result.error}`);
    }
  } catch (error) {
    status.className = 'status-indicator status-error';
    alert(`✗ Error: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test Connection';
  }
}

/**
 * Update progress display
 */
function updateProgress(data) {
  const noActiveBatch = document.getElementById('noActiveBatch');
  const batchProgress = document.getElementById('batchProgress');

  noActiveBatch.style.display = 'none';
  batchProgress.style.display = 'block';

  document.getElementById('currentBatchName').textContent = data.batchName || 'Batch';
  document.getElementById('currentBatchId').textContent = `ID: ${data.batchId}`;
  document.getElementById('totalCount').textContent = data.totalCount;
  document.getElementById('processedCount').textContent = data.processedCount;
  document.getElementById('failedCount').textContent = data.failedCount || 0;

  const progress = (data.processedCount / data.totalCount * 100).toFixed(1);
  document.getElementById('progressPercent').textContent = `${progress}%`;
  document.getElementById('progressBar').style.width = `${progress}%`;
}

/**
 * Log activity
 */
function logActivity(message, type = 'info') {
  const logContent = document.getElementById('activityLogContent');
  const timestamp = new Date().toLocaleTimeString();

  const logEntry = document.createElement('div');
  logEntry.className = `log-entry log-${type}`;
  logEntry.textContent = `[${timestamp}] ${message}`;

  logContent.insertBefore(logEntry, logContent.firstChild);

  // Keep only last 100 entries
  while (logContent.children.length > 100) {
    logContent.removeChild(logContent.lastChild);
  }
}

/**
 * Update monitor tab
 */
async function updateMonitorTab() {
  if (!currentBatchId) {
    document.getElementById('noActiveBatch').style.display = 'block';
    document.getElementById('batchProgress').style.display = 'none';
    return;
  }

  const result = await ipcRenderer.invoke('get-batch-status', null);

  if (result.success && result.status) {
    updateProgress({
      batchId: result.status.batchId,
      batchName: result.status.batchName,
      totalCount: result.status.totalCount,
      processedCount: result.status.processedCount,
      failedCount: result.status.failedCount
    });
  }
}

/**
 * Load recent batches
 */
async function loadRecentBatches() {
  const tbody = document.getElementById('historyTableBody');
  tbody.innerHTML = '<tr><td colspan="9" class="loading">Loading...</td></tr>';

  try {
    const result = await ipcRenderer.invoke('get-recent-batches', 50);

    if (result.success && result.batches) {
      tbody.innerHTML = '';

      if (result.batches.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty">No batches found</td></tr>';
        return;
      }

      result.batches.forEach(batch => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${batch.id}</td>
          <td>${escapeHtml(batch.batch_name)}</td>
          <td>${escapeHtml(batch.user_id)}</td>
          <td>${batch.total_faxes}</td>
          <td>${batch.completed_faxes}</td>
          <td>${batch.failed_faxes}</td>
          <td><span class="status-badge status-${batch.status}">${batch.status}</span></td>
          <td>${new Date(batch.created_at).toLocaleString()}</td>
          <td>
            <button class="btn btn-small" onclick="viewBatchDetails(${batch.id})">View</button>
          </td>
        `;
        tbody.appendChild(row);
      });
    }
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="9" class="error">Error: ${error.message}</td></tr>`;
  }
}

/**
 * View batch details
 */
async function viewBatchDetails(batchId) {
  const result = await ipcRenderer.invoke('get-batch-status', batchId);

  if (result.success && result.batch) {
    const batch = result.batch;
    const submissions = result.submissions || [];

    const successCount = submissions.filter(s => s.status === 'sent').length;
    const failedCount = submissions.filter(s => s.status === 'failed').length;

    alert(`Batch Details\n\n` +
      `Batch ID: ${batch.id}\n` +
      `Name: ${batch.batch_name}\n` +
      `User: ${batch.user_id}\n` +
      `Total: ${batch.total_faxes}\n` +
      `Completed: ${batch.completed_faxes}\n` +
      `Failed: ${batch.failed_faxes}\n` +
      `Status: ${batch.status}\n` +
      `Created: ${new Date(batch.created_at).toLocaleString()}\n` +
      `Started: ${batch.started_at ? new Date(batch.started_at).toLocaleString() : 'N/A'}\n` +
      `Completed: ${batch.completed_at ? new Date(batch.completed_at).toLocaleString() : 'N/A'}\n\n` +
      `Submissions: ${submissions.length}\n` +
      `Success: ${successCount}\n` +
      `Failed: ${failedCount}`
    );
  }
}

/**
 * Load dashboard data
 */
async function loadDashboardData() {
  try {
    const result = await ipcRenderer.invoke('get-dashboard-data');

    if (result.success && result.data) {
      const { today } = result.data;

      document.getElementById('totalToday').textContent = today.total_today || 0;
      document.getElementById('succeededToday').textContent = today.succeeded_today || 0;
      document.getElementById('failedToday').textContent = today.failed_today || 0;

      const avgDuration = today.avg_duration_today ? (today.avg_duration_today / 1000).toFixed(1) : 0;
      document.getElementById('avgDurationToday').textContent = `${avgDuration}s`;
    }

    // Load performance metrics
    const perfResult = await ipcRenderer.invoke('get-performance-stats', 7);

    if (perfResult.success && perfResult.stats) {
      const stats = perfResult.stats;
      const metricsContainer = document.getElementById('performanceMetrics');

      metricsContainer.innerHTML = `
        <div class="metrics-grid">
          <div class="metric-item">
            <div class="metric-label">Avg Conversion Time</div>
            <div class="metric-value">${(stats.avg_conversion / 1000).toFixed(2)}s</div>
          </div>
          <div class="metric-item">
            <div class="metric-label">Avg Transmission Time</div>
            <div class="metric-value">${(stats.avg_transmission / 1000).toFixed(2)}s</div>
          </div>
          <div class="metric-item">
            <div class="metric-label">Avg Total Time</div>
            <div class="metric-value">${(stats.avg_total / 1000).toFixed(2)}s</div>
          </div>
          <div class="metric-item">
            <div class="metric-label">P95 Total Time</div>
            <div class="metric-value">${(stats.p95_total / 1000).toFixed(2)}s</div>
          </div>
        </div>
      `;
    }
  } catch (error) {
    console.error('Error loading dashboard data:', error);
  }
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initialize);

// Auto-refresh monitor tab every 2 seconds
setInterval(() => {
  const monitorTab = document.getElementById('monitor-tab');
  if (monitorTab.classList.contains('active')) {
    updateMonitorTab();
  }
}, 2000);
