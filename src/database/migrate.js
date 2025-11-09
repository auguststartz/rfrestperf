#!/usr/bin/env node

const db = require('./db');
const logger = require('../utils/logger');

/**
 * Run database migrations
 */
async function migrate() {
  logger.log('Starting database migration...');

  try {
    await db.initializeDatabase();
    logger.log('✓ Database migration completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('✗ Database migration failed:', error.message);
    process.exit(1);
  }
}

// Run migration if called directly
if (require.main === module) {
  migrate();
}

module.exports = migrate;
