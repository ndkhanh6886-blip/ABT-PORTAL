const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || '127.0.0.1',
  port: parseInt(process.env.PGPORT || '5432'),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || 'abt_portal'
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('Connected to PostgreSQL database...');

    // 1. Update accountants (TBR005, TBR006)
    const resAcc = await client.query(
      `UPDATE users SET role = 'accountant' WHERE username IN ('TBR004', 'TBR005', 'TBR006') RETURNING username, full_name, role`
    );
    console.log('Updated Accountants:', resAcc.rows);

    // 2. Update Sales Admin accounts (TBR018 - TBR022) to sales_rep
    const resSales = await client.query(
      `UPDATE users SET role = 'sales_rep' WHERE username IN ('TBR018', 'TBR019', 'TBR020', 'TBR021', 'TBR022') RETURNING username, full_name, role`
    );
    console.log('Updated Sales Admins to sales_rep:', resSales.rows);

    // 3. Print full users table
    const allUsers = await client.query(
      `SELECT id, username, full_name, role, department, email FROM users ORDER BY id`
    );
    console.log('\n--- CURRENT USERS IN POSTGRESQL ---');
    console.table(allUsers.rows);

  } catch (err) {
    console.error('Error fixing user roles:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
