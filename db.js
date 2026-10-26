require('dotenv').config();
const { Pool, types } = require('pg');
types.setTypeParser(1700, parseFloat);   // NUMERIC -> nombre JS
types.setTypeParser(1082, (v) => v);     // DATE -> "AAAA-MM-JJ"
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL est manquante. Copiez .env.example en .env et renseignez-la.');
  process.exit(1);
}
const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false;
module.exports = new Pool({ connectionString: process.env.DATABASE_URL, ssl, max: 8 });
