const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: process.env.PGPASSWORD, database: 'tbrs_portal' });
async function check() {
  const res = await pool.query("SELECT username, full_name, role, department FROM users WHERE username = 'test.role'");
  console.log('Result for test.role:');
  console.table(res.rows);
  await pool.query("DELETE FROM users WHERE username = 'test.role'");
  await pool.query("DELETE FROM personnel WHERE employee_code = 'NV-TBR-TEST1'");
  await pool.end();
}
check();
