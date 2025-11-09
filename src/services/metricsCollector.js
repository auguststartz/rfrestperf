const db = require('../database/db');
const { format, startOfDay, startOfHour } = require('date-fns');
const logger = require('../utils/logger');

/**
 * Metrics Collector Service
 * Aggregates fax metrics for Grafana dashboards
 */
class MetricsCollector {
  constructor() {
    this.collectionInterval = null;
    this.intervalMs = 5 * 60 * 1000; // Collect metrics every 5 minutes
  }

  /**
   * Start automatic metrics collection
   */
  start() {
    logger.log('Starting metrics collector...');

    // Collect immediately
    this.collectMetrics().catch(error => {
      logger.error('Initial metrics collection failed:', error);
    });

    // Then collect periodically
    this.collectionInterval = setInterval(() => {
      this.collectMetrics().catch(error => {
        logger.error('Periodic metrics collection failed:', error);
      });
    }, this.intervalMs);
  }

  /**
   * Stop automatic metrics collection
   */
  stop() {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
      logger.log('Metrics collector stopped');
    }
  }

  /**
   * Collect and store metrics
   */
  async collectMetrics() {
    try {
      const now = new Date();
      const currentDate = startOfDay(now);
      const currentHour = now.getHours();

      logger.log(`Collecting metrics for ${format(currentDate, 'yyyy-MM-dd')} hour ${currentHour}...`);

      // Get metrics from the last hour
      const hourStart = startOfHour(now);
      const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);

      const result = await db.query(
        `SELECT
          COUNT(*) as total_submitted,
          SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as total_succeeded,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as total_failed,
          SUM(CASE WHEN status IN ('cancelled', 'canceled') THEN 1 ELSE 0 END) as total_cancelled,
          AVG(conversion_duration) as avg_conversion_time,
          AVG(transmission_duration) as avg_transmission_time,
          AVG(total_duration) as avg_total_time,
          MAX(conversion_duration) as max_conversion_time,
          MAX(transmission_duration) as max_transmission_time,
          SUM(page_count) as total_pages,
          COUNT(DISTINCT batch_id) as total_batches
        FROM fax_submissions
        WHERE queued_at >= $1 AND queued_at < $2`,
        [hourStart, hourEnd]
      );

      if (result.rows.length > 0) {
        const metrics = result.rows[0];

        await db.updateMetrics({
          date: currentDate,
          hour: currentHour,
          total_submitted: parseInt(metrics.total_submitted) || 0,
          total_succeeded: parseInt(metrics.total_succeeded) || 0,
          total_failed: parseInt(metrics.total_failed) || 0,
          total_cancelled: parseInt(metrics.total_cancelled) || 0,
          avg_conversion_time: Math.round(metrics.avg_conversion_time) || 0,
          avg_transmission_time: Math.round(metrics.avg_transmission_time) || 0,
          avg_total_time: Math.round(metrics.avg_total_time) || 0,
          max_conversion_time: parseInt(metrics.max_conversion_time) || 0,
          max_transmission_time: parseInt(metrics.max_transmission_time) || 0,
          total_pages: parseInt(metrics.total_pages) || 0,
          total_batches: parseInt(metrics.total_batches) || 0
        });

        logger.log(`✓ Metrics collected: ${metrics.total_submitted} submissions, ${metrics.total_succeeded} succeeded`);
      }
    } catch (error) {
      logger.error('Metrics collection error:', error);
      throw error;
    }
  }

  /**
   * Get metrics for a date range
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Array>}
   */
  async getMetrics(startDate, endDate) {
    try {
      const result = await db.query(
        `SELECT
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
        FROM fax_metrics
        WHERE date >= $1 AND date <= $2
        ORDER BY date, hour`,
        [startDate, endDate]
      );

      return result.rows;
    } catch (error) {
      logger.error('Get metrics error:', error);
      throw error;
    }
  }

  /**
   * Get real-time dashboard data
   * @returns {Promise<Object>}
   */
  async getDashboardData() {
    try {
      // Get today's stats
      const today = startOfDay(new Date());

      const todayStats = await db.query(
        `SELECT
          COUNT(*) as total_today,
          SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as succeeded_today,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_today,
          AVG(total_duration) as avg_duration_today
        FROM fax_submissions
        WHERE DATE(queued_at) = $1`,
        [today]
      );

      // Get active batches
      const activeBatches = await db.query(
        `SELECT
          id,
          batch_name,
          total_faxes,
          completed_faxes,
          failed_faxes,
          status,
          created_at
        FROM fax_batches
        WHERE status IN ('pending', 'processing')
        ORDER BY created_at DESC
        LIMIT 10`
      );

      // Get recent completions
      const recentCompletions = await db.query(
        `SELECT
          COUNT(*) as count,
          DATE_TRUNC('minute', updated_at) as minute
        FROM fax_submissions
        WHERE updated_at > NOW() - INTERVAL '1 hour'
          AND status IN ('sent', 'failed')
        GROUP BY minute
        ORDER BY minute DESC`
      );

      return {
        today: todayStats.rows[0] || {},
        activeBatches: activeBatches.rows || [],
        recentCompletions: recentCompletions.rows || []
      };
    } catch (error) {
      logger.error('Get dashboard data error:', error);
      throw error;
    }
  }

  /**
   * Get performance statistics
   * @param {number} days - Number of days to analyze
   * @returns {Promise<Object>}
   */
  async getPerformanceStats(days = 7) {
    try {
      const result = await db.query(
        `SELECT
          AVG(conversion_duration) as avg_conversion,
          AVG(transmission_duration) as avg_transmission,
          AVG(total_duration) as avg_total,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY conversion_duration) as median_conversion,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY transmission_duration) as median_transmission,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_duration) as median_total,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY conversion_duration) as p95_conversion,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY transmission_duration) as p95_transmission,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_duration) as p95_total,
          MIN(conversion_duration) as min_conversion,
          MIN(transmission_duration) as min_transmission,
          MIN(total_duration) as min_total,
          MAX(conversion_duration) as max_conversion,
          MAX(transmission_duration) as max_transmission,
          MAX(total_duration) as max_total
        FROM fax_submissions
        WHERE queued_at > NOW() - INTERVAL '${days} days'
          AND status = 'sent'
          AND conversion_duration IS NOT NULL
          AND transmission_duration IS NOT NULL`
      );

      return result.rows[0] || {};
    } catch (error) {
      logger.error('Get performance stats error:', error);
      throw error;
    }
  }
}

module.exports = MetricsCollector;
