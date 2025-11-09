const FaxApiClient = require('../api/faxApi');
const db = require('../database/db');
const EventEmitter = require('events');
const { format } = require('date-fns');
const logger = require('../utils/logger');

/**
 * Batch Fax Processor
 * Handles batch submission of faxes with rate limiting and progress tracking
 */
class BatchProcessor extends EventEmitter {
  constructor(connectionSettings = null) {
    super();
    this.connectionSettings = connectionSettings;
    this.faxApi = connectionSettings ? new FaxApiClient(connectionSettings) : new FaxApiClient();
    this.isProcessing = false;
    this.currentBatch = null;
    this.processedCount = 0;
    this.failedCount = 0;
    this.maxConcurrent = parseInt(process.env.MAX_CONCURRENT_FAXES) || 10;
    this.batchSize = parseInt(process.env.BATCH_SIZE) || 100;
    this.activeRequests = new Set();
  }

  /**
   * Update connection settings
   * @param {Object} connectionSettings - New connection settings
   */
  updateConnectionSettings(connectionSettings) {
    this.connectionSettings = connectionSettings;
    this.faxApi = connectionSettings ? new FaxApiClient(connectionSettings) : new FaxApiClient();
    logger.log('✓ Batch processor connection settings updated');
  }

  /**
   * Start batch fax processing
   * @param {Object} batchConfig - Batch configuration
   * @returns {Promise<number>} - Batch ID
   */
  async startBatch(batchConfig) {
    const {
      batchName,
      userId,
      filePath,
      destinationNumber,
      recipientName,
      totalCount,
      priority,
      billingCode1,
      billingCode2
    } = batchConfig;

    try {
      // Ensure logged in
      if (!this.faxApi.isLoggedIn()) {
        await this.faxApi.login();
      }

      // Get file size
      const fs = require('fs');
      const fileStats = fs.statSync(filePath);

      // Create batch record
      const batchId = await db.createBatch({
        batch_name: batchName,
        user_id: userId,
        total_faxes: totalCount,
        file_path: filePath,
        file_size: fileStats.size,
        destination_number: destinationNumber
      });

      this.currentBatch = {
        id: batchId,
        batchName,
        userId,
        filePath,
        destinationNumber,
        recipientName,
        totalCount,
        priority,
        billingCode1,
        billingCode2,
        processedCount: 0,
        failedCount: 0
      };

      // Update batch status
      await db.updateBatch(batchId, {
        status: 'processing',
        started_at: new Date()
      });

      this.emit('batchStarted', {
        batchId,
        totalCount
      });

      // Start processing in background
      this._processBatch().catch(error => {
        logger.error('Batch processing error:', error);
        this.emit('batchError', { batchId, error: error.message });
      });

      return batchId;
    } catch (error) {
      logger.error('Failed to start batch:', error);
      throw error;
    }
  }

  /**
   * Process the batch
   * @private
   */
  async _processBatch() {
    const {
      id: batchId,
      filePath,
      destinationNumber,
      recipientName,
      totalCount,
      priority,
      billingCode1,
      billingCode2
    } = this.currentBatch;

    this.isProcessing = true;

    try {
      // Upload the file once (reuse for all faxes in batch)
      this.emit('uploadingFile', { batchId });
      const attachmentUrl = await this.faxApi.uploadAttachment(filePath);
      this.emit('fileUploaded', { batchId, attachmentUrl });

      // Process in chunks to avoid overwhelming the server
      const chunks = Math.ceil(totalCount / this.batchSize);

      for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
        const chunkStart = chunkIndex * this.batchSize;
        const chunkEnd = Math.min(chunkStart + this.batchSize, totalCount);
        const chunkSize = chunkEnd - chunkStart;

        this.emit('chunkStarted', {
          batchId,
          chunkIndex: chunkIndex + 1,
          totalChunks: chunks,
          chunkSize
        });

        // Create array of promises for concurrent processing
        const promises = [];

        for (let i = 0; i < chunkSize; i++) {
          // Limit concurrent requests
          while (this.activeRequests.size >= this.maxConcurrent) {
            await this._delay(100);
          }

          const submissionNumber = chunkStart + i + 1;
          const promise = this._sendSingleFax({
            batchId,
            submissionNumber,
            destinationNumber,
            recipientName,
            attachmentUrl,
            priority,
            billingCode1,
            billingCode2
          });

          this.activeRequests.add(promise);
          promise.finally(() => this.activeRequests.delete(promise));

          promises.push(promise);
        }

        // Wait for all in this chunk to complete
        await Promise.allSettled(promises);

        this.emit('chunkCompleted', {
          batchId,
          chunkIndex: chunkIndex + 1,
          totalChunks: chunks,
          processedCount: this.currentBatch.processedCount,
          failedCount: this.currentBatch.failedCount
        });
      }

      // Update batch as completed
      await db.updateBatch(batchId, {
        status: 'completed',
        completed_at: new Date(),
        completed_faxes: this.currentBatch.processedCount,
        failed_faxes: this.currentBatch.failedCount
      });

      this.emit('batchCompleted', {
        batchId,
        totalCount,
        successCount: this.currentBatch.processedCount,
        failedCount: this.currentBatch.failedCount
      });

    } catch (error) {
      logger.error('Batch processing failed:', error);

      await db.updateBatch(batchId, {
        status: 'failed',
        completed_at: new Date()
      });

      this.emit('batchFailed', {
        batchId,
        error: error.message
      });
    } finally {
      this.isProcessing = false;
      this.currentBatch = null;
    }
  }

  /**
   * Send a single fax
   * @private
   */
  async _sendSingleFax(config) {
    const {
      batchId,
      submissionNumber,
      destinationNumber,
      recipientName,
      attachmentUrl,
      priority,
      billingCode1,
      billingCode2
    } = config;

    let submissionId = null;

    try {
      // Create send job
      const sendJobResult = await this.faxApi.createSendJob({
        recipients: [{
          name: recipientName || `Recipient ${submissionNumber}`,
          destination: destinationNumber
        }],
        attachmentUrls: [attachmentUrl],
        priority,
        billingCode1,
        billingCode2
      });

      const sendJobId = sendJobResult.sendJobId;
      const faxHandle = sendJobId;

      // Create submission record
      submissionId = await db.createSubmission({
        batch_id: batchId,
        fax_handle: faxHandle,
        send_job_id: sendJobId,
        destination_number: destinationNumber,
        recipient_name: recipientName || `Recipient ${submissionNumber}`,
        status: 'converting',
        priority,
        billing_code1: billingCode1,
        billing_code2: billingCode2
      });

      this.currentBatch.processedCount++;

      this.emit('faxSubmitted', {
        batchId,
        submissionNumber,
        sendJobId,
        submissionId,
        totalCount: this.currentBatch.totalCount,
        processedCount: this.currentBatch.processedCount
      });

      // Start monitoring this fax in background
      this._monitorFax(faxHandle, submissionId).catch(error => {
        logger.error(`Error monitoring fax ${faxHandle}:`, error);
      });

      return { success: true, sendJobId, submissionId };

    } catch (error) {
      logger.error(`Failed to send fax ${submissionNumber}:`, error.message);

      this.currentBatch.failedCount++;

      // Create failed submission record if we have batch ID
      if (submissionId === null) {
        try {
          await db.createSubmission({
            batch_id: batchId,
            fax_handle: `failed-${Date.now()}-${submissionNumber}`,
            destination_number: destinationNumber,
            recipient_name: recipientName || `Recipient ${submissionNumber}`,
            status: 'failed',
            priority,
            error_message: error.message
          });
        } catch (dbError) {
          logger.error('Failed to create failed submission record:', dbError);
        }
      }

      this.emit('faxFailed', {
        batchId,
        submissionNumber,
        error: error.message
      });

      return { success: false, error: error.message };
    }
  }

  /**
   * Monitor a fax until completion
   * @private
   */
  async _monitorFax(faxHandle, submissionId) {
    const maxAttempts = 120; // Monitor for up to 10 minutes (120 * 5 seconds)
    let attempts = 0;

    const conversionStartTime = Date.now();
    let transmissionStartTime = null;

    while (attempts < maxAttempts) {
      try {
        await this._delay(5000); // Check every 5 seconds

        // Get send job status
        const sendJob = await this.faxApi.getSendJob(faxHandle);

        // Update submission with current status
        const updates = {
          status: sendJob.Status.toLowerCase(),
          condition: sendJob.Condition
        };

        // Get documents for this send job
        const documents = await this.faxApi.getDocumentsForSendJob(faxHandle);

        if (documents.length > 0) {
          const doc = documents[0];

          updates.document_id = doc.Id;
          updates.page_count = doc.PageCount;

          // Check for completion conditions
          if (doc.Condition === 'Succeeded') {
            const now = Date.now();

            if (!transmissionStartTime) {
              transmissionStartTime = now;
            }

            updates.status = 'sent';
            updates.conversion_completed_at = new Date(conversionStartTime + 5000);
            updates.transmission_completed_at = new Date();
            updates.conversion_duration = Math.round((transmissionStartTime - conversionStartTime) / 1000) * 1000;
            updates.transmission_duration = Math.round((now - transmissionStartTime) / 1000) * 1000;
            updates.total_duration = now - conversionStartTime;

            await db.updateSubmission(faxHandle, updates);

            // Get and store activities
            await this._storeActivities(doc.Id, submissionId);

            this.emit('faxCompleted', {
              faxHandle,
              submissionId,
              status: 'succeeded',
              duration: updates.total_duration
            });

            return;
          } else if (doc.Condition === 'Failed' || doc.Condition === 'Canceled') {
            updates.status = doc.Condition.toLowerCase();

            await db.updateSubmission(faxHandle, updates);

            // Get and store activities to capture error details
            await this._storeActivities(doc.Id, submissionId);

            this.emit('faxCompleted', {
              faxHandle,
              submissionId,
              status: doc.Condition.toLowerCase()
            });

            return;
          }
        }

        await db.updateSubmission(faxHandle, updates);

        attempts++;
      } catch (error) {
        logger.error(`Error monitoring fax ${faxHandle}:`, error.message);
        attempts++;
      }
    }

    // Timeout
    await db.updateSubmission(faxHandle, {
      status: 'timeout',
      error_message: 'Monitoring timeout - fax status unknown'
    });
  }

  /**
   * Store document activities in database
   * @private
   */
  async _storeActivities(documentId, submissionId) {
    try {
      const activities = await this.faxApi.getDocumentActivities(documentId);

      for (const activity of activities) {
        await db.createActivity(submissionId, {
          activity_id: activity.Id,
          message: activity.Message,
          timestamp: new Date(activity.Timestamp),
          user_id: activity.UserId,
          user_display_name: activity.UserDisplayName,
          condition: activity.Condition,
          status: activity.Status,
          is_diagnostic: activity.IsDiagnostic
        });
      }
    } catch (error) {
      logger.error('Failed to store activities:', error.message);
    }
  }

  /**
   * Delay helper
   * @private
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current batch status
   * @returns {Object|null}
   */
  getCurrentBatchStatus() {
    if (!this.currentBatch) {
      return null;
    }

    return {
      batchId: this.currentBatch.id,
      batchName: this.currentBatch.batchName,
      totalCount: this.currentBatch.totalCount,
      processedCount: this.currentBatch.processedCount,
      failedCount: this.currentBatch.failedCount,
      isProcessing: this.isProcessing,
      progress: (this.currentBatch.processedCount / this.currentBatch.totalCount * 100).toFixed(2)
    };
  }

  /**
   * Stop processing (graceful shutdown)
   */
  async stop() {
    this.isProcessing = false;
    // Wait for active requests to complete
    await Promise.allSettled(Array.from(this.activeRequests));
  }
}

module.exports = BatchProcessor;
