require('../config/env').validateEnvironment();
const fs = require('node:fs/promises');
const path = require('node:path');
const { pool } = require('../config/database');

(async () => {
  try {
    const [tokenVersionColumn] = await pool.query("SHOW COLUMNS FROM users LIKE 'token_version'");
    if (!tokenVersionColumn.length) {
      await pool.query('ALTER TABLE users ADD COLUMN token_version INT UNSIGNED NOT NULL DEFAULT 0 AFTER account_status');
      console.log('Added users.token_version for revoking older sessions after password changes.');
    }
    const [temporaryPasswordColumn] = await pool.query("SHOW COLUMNS FROM users LIKE 'must_change_password'");
    if (!temporaryPasswordColumn.length) {
      await pool.query('ALTER TABLE users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0 AFTER token_version');
      console.log('Added users.must_change_password for first-login password changes.');
    }
    const sql = await fs.readFile(path.join(__dirname, '..', 'migrations', '001_authentication.sql'), 'utf8');
    for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) await pool.query(statement);
    console.log('Authentication schema migration completed.');
  } catch (error) {
    console.error('Authentication schema migration failed:', error.code || error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
