// Usage : npm run db:init   |   npm run db:reset (efface TOUT puis recrée)
const fs = require('fs'); const path = require('path');
const pool = require('../db'); const seed = require('./seed');

async function ensureSchema() {
  await pool.query(fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8'));
}
async function initDb({ reset = false, withSeed = true } = {}) {
  if (reset) { await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); console.log('[db] Schéma réinitialisé.'); }
  await ensureSchema(); console.log('[db] Tables prêtes.');
  if (withSeed) await seed(pool);
}
module.exports = { initDb };

if (require.main === module) {
  initDb({ reset: process.argv.includes('--reset') })
    .then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
