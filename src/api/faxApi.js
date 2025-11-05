const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

/**
 * OpenText Fax API Client
 * Based on OpenText Fax Web API SDK Installation and Quick Start Guide
 */
class FaxApiClient {
  constructor() {
    this.baseURL = process.env.FAX_API_URL;
    this.username = process.env.FAX_USERNAME;
    this.password = process.env.FAX_PASSWORD;
    this.sessionCookie = null;
    this.axiosInstance = null;
  }

  /**
   * Initialize axios instance with base configuration
   */
  _initializeAxios() {
    this.axiosInstance = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      maxRedirects: 5,
      validateStatus: (status) => status < 500
    });

    // Add response interceptor to handle errors
    this.axiosInstance.interceptors.response.use(
      response => response,
      error => {
        console.error('API Request failed:', {
          url: error.config?.url,
          method: error.config?.method,
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Login to the fax server and obtain session cookie
   * @returns {Promise<Object>} - Login response with user and session info
   */
  async login() {
    try {
      this._initializeAxios();

      // Create base64 encoded credentials for basic authentication
      const credentials = Buffer.from(`${this.username}:${this.password}`).toString('base64');

      const response = await this.axiosInstance.get('/login', {
        headers: {
          'Authorization': `Basic ${credentials}`
        }
      });

      if (response.status === 200) {
        // Extract session cookie from response headers
        const setCookie = response.headers['set-cookie'];
        if (setCookie && setCookie.length > 0) {
          // Find rf-auth cookie
          const authCookie = setCookie.find(cookie => cookie.startsWith('rf-auth='));
          if (authCookie) {
            // Extract just the cookie value
            this.sessionCookie = authCookie.split(';')[0];
            console.log('✓ Successfully logged in to fax server');

            // Update axios instance to use session cookie
            this.axiosInstance.defaults.headers.common['Cookie'] = this.sessionCookie;

            return {
              success: true,
              user: response.data.User,
              account: response.data.Account,
              server: response.data.Server,
              serverVersion: response.data.ServerVersion
            };
          }
        }
        throw new Error('No session cookie received from server');
      } else {
        throw new Error(`Login failed with status ${response.status}`);
      }
    } catch (error) {
      console.error('Login error:', error.message);
      throw new Error(`Failed to login to fax server: ${error.message}`);
    }
  }

  /**
   * Logout from the fax server
   * @returns {Promise<boolean>}
   */
  async logout() {
    try {
      await this.axiosInstance.get('/logout');
      this.sessionCookie = null;
      console.log('✓ Successfully logged out from fax server');
      return true;
    } catch (error) {
      console.error('Logout error:', error.message);
      return false;
    }
  }

  /**
   * Upload a file attachment to the fax server
   * @param {string} filePath - Path to the file to upload
   * @returns {Promise<string>} - Attachment URL
   */
  async uploadAttachment(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const fileName = path.basename(filePath);
      const fileStream = fs.createReadStream(filePath);
      const fileStats = fs.statSync(filePath);

      const formData = new FormData();
      formData.append(fileName, fileStream, {
        filename: fileName,
        contentType: 'application/binary',
        knownLength: fileStats.size
      });

      const response = await this.axiosInstance.post('/Attachments', formData, {
        headers: {
          ...formData.getHeaders(),
          'Cookie': this.sessionCookie
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      });

      if (response.status === 201) {
        const attachmentUrl = response.headers['location'] || response.data;
        console.log(`✓ File uploaded successfully: ${fileName}`);
        return attachmentUrl;
      } else {
        throw new Error(`Upload failed with status ${response.status}`);
      }
    } catch (error) {
      console.error('File upload error:', error.message);
      throw new Error(`Failed to upload file: ${error.message}`);
    }
  }

  /**
   * Create a send job (send a fax)
   * @param {Object} sendJobData - Send job configuration
   * @returns {Promise<Object>} - Send job response
   */
  async createSendJob(sendJobData) {
    try {
      const {
        recipients,
        attachmentUrls,
        priority = 'Normal',
        holdForPreview = false,
        billingCode1 = '',
        billingCode2 = '',
        coversheetTemplateId = ''
      } = sendJobData;

      const payload = {
        Recipients: recipients.map(recipient => ({
          Name: recipient.name || '',
          Destination: recipient.destination
        })),
        AttachmentUrls: attachmentUrls,
        Priority: priority,
        HoldForPreview: holdForPreview,
        BillingCode1: billingCode1,
        BillingCode2: billingCode2
      };

      if (coversheetTemplateId) {
        payload.CoversheetTemplateId = coversheetTemplateId;
      }

      const response = await this.axiosInstance.post('/SendJobs', payload, {
        headers: {
          'Cookie': this.sessionCookie,
          'Content-Type': 'application/json'
        }
      });

      if (response.status === 201) {
        const sendJob = response.data;
        console.log(`✓ Send job created: ID ${sendJob.Id}`);
        return {
          success: true,
          sendJobId: sendJob.Id,
          documentCount: sendJob.DocumentCount,
          status: sendJob.Status,
          condition: sendJob.Condition,
          links: sendJob.Links,
          fullResponse: sendJob
        };
      } else {
        throw new Error(`Send job creation failed with status ${response.status}`);
      }
    } catch (error) {
      console.error('Send job creation error:', error.message);
      throw new Error(`Failed to create send job: ${error.message}`);
    }
  }

  /**
   * Get send job status
   * @param {string} sendJobId - Send job ID
   * @returns {Promise<Object>} - Send job details
   */
  async getSendJob(sendJobId) {
    try {
      const response = await this.axiosInstance.get(`/SendJobs/${sendJobId}`, {
        headers: {
          'Cookie': this.sessionCookie
        }
      });

      if (response.status === 200) {
        return response.data;
      } else {
        throw new Error(`Failed to get send job with status ${response.status}`);
      }
    } catch (error) {
      console.error('Get send job error:', error.message);
      throw new Error(`Failed to get send job: ${error.message}`);
    }
  }

  /**
   * Get documents for a send job
   * @param {string} sendJobId - Send job ID
   * @returns {Promise<Array>} - Array of documents
   */
  async getDocumentsForSendJob(sendJobId) {
    try {
      const response = await this.axiosInstance.get('/Documents', {
        params: {
          filter: 'job',
          jobid: sendJobId
        },
        headers: {
          'Cookie': this.sessionCookie
        }
      });

      if (response.status === 200) {
        return response.data.Items || [];
      } else {
        throw new Error(`Failed to get documents with status ${response.status}`);
      }
    } catch (error) {
      console.error('Get documents error:', error.message);
      throw new Error(`Failed to get documents: ${error.message}`);
    }
  }

  /**
   * Get document details
   * @param {string} documentId - Document ID
   * @returns {Promise<Object>} - Document details
   */
  async getDocument(documentId) {
    try {
      const response = await this.axiosInstance.get(`/Documents/${documentId}`, {
        headers: {
          'Cookie': this.sessionCookie
        }
      });

      if (response.status === 200) {
        return response.data;
      } else {
        throw new Error(`Failed to get document with status ${response.status}`);
      }
    } catch (error) {
      console.error('Get document error:', error.message);
      throw new Error(`Failed to get document: ${error.message}`);
    }
  }

  /**
   * Get document activities (history)
   * @param {string} documentId - Document ID
   * @returns {Promise<Array>} - Array of activities
   */
  async getDocumentActivities(documentId) {
    try {
      const response = await this.axiosInstance.get('/DocumentActivities', {
        params: {
          documentId: documentId
        },
        headers: {
          'Cookie': this.sessionCookie
        }
      });

      if (response.status === 200) {
        return response.data.Items || [];
      } else {
        throw new Error(`Failed to get activities with status ${response.status}`);
      }
    } catch (error) {
      console.error('Get document activities error:', error.message);
      throw new Error(`Failed to get document activities: ${error.message}`);
    }
  }

  /**
   * Get received faxes in a time window
   * @param {Date} minTime - Start time
   * @param {Date} maxTime - End time
   * @returns {Promise<Array>} - Array of received documents
   */
  async getReceivedFaxes(minTime, maxTime) {
    try {
      const formatTime = (date) => {
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const yyyy = date.getFullYear();
        const hh = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        const ss = String(date.getSeconds()).padStart(2, '0');
        return `${mm}/${dd}/${yyyy} ${hh}:${min}:${ss}`;
      };

      const response = await this.axiosInstance.get('/Documents', {
        params: {
          minTransmitTime: formatTime(minTime),
          maxTransmitTime: formatTime(maxTime),
          filter: 'Received'
        },
        headers: {
          'Cookie': this.sessionCookie
        }
      });

      if (response.status === 200) {
        return response.data.Items || [];
      } else {
        throw new Error(`Failed to get received faxes with status ${response.status}`);
      }
    } catch (error) {
      console.error('Get received faxes error:', error.message);
      throw new Error(`Failed to get received faxes: ${error.message}`);
    }
  }

  /**
   * Get system features
   * @returns {Promise<Object>} - System features
   */
  async getSystemFeatures() {
    try {
      const response = await this.axiosInstance.get('/Settings/features');

      if (response.status === 200) {
        return response.data;
      } else {
        throw new Error(`Failed to get system features with status ${response.status}`);
      }
    } catch (error) {
      console.error('Get system features error:', error.message);
      throw new Error(`Failed to get system features: ${error.message}`);
    }
  }

  /**
   * Check if logged in
   * @returns {boolean}
   */
  isLoggedIn() {
    return this.sessionCookie !== null;
  }
}

module.exports = FaxApiClient;
