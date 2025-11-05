#!/usr/bin/env node

const db = require('./db');

/**
 * Run database migrations
 */
async function migrate() {
  console.log('Starting database migration...');

  try {
    await db.initializeDatabase();
    console.log('✓ Database migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('✗ Database migration failed:', error.message);
    process.exit(1);
  }
}

// Run migration if called directly
if (require.main === module) {
  migrate();
}

module.exports = migrate;
