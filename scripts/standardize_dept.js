const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: process.env.PGPASSWORD, database: 'tbrs_portal' });
async function run() {
  await pool.query("UPDATE users SET department = 'Pháp Chế' WHERE department ILIKE 'pháp chế'");
  await pool.query("UPDATE personnel SET department = 'Pháp Chế' WHERE department ILIKE 'pháp chế'");
  console.log('Successfully standardized department Pháp Chế in PostgreSQL!');
  await pool.end();
}
run();
