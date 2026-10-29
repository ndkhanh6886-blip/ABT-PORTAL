const { Pool } = require('pg');

const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  user: 'postgres',
  password: process.env.PGPASSWORD,
  database: 'abt_portal'
});

async function main() {
  console.log('--- CLEANING POSTGRESQL MOCK DATA ---');

  const mockKeys = [
    'sales_deals_pipeline',
    'sales_hospital_bids',
    'sales_reagent_rentals',
    'sales_contracts',
    'sales_quotations',
    'sales_commercial_products',
    'tbr_activity_notifications',
    'sales_delivery_slips',
    'sales_specialized_plans',
    'sales_factory_orders',
    'sales_targets',
    'legal_contracts',
    'legal_licenses',
    'legal_tenders',
    'sales_tasks',
    'sales_plans',
    'sales_daily_logs',
    'sales_custom_customers',
    'sales_product_customizations',
    'test_backend_health_check'
  ];

  for (const k of mockKeys) {
    const res = await pool.query('DELETE FROM app_storage WHERE key = $1', [k]);
    if (res.rowCount > 0) {
      console.log(`Deleted key from app_storage: ${k} (${res.rowCount} rows)`);
    }
  }

  const tablesToTruncate = [
    'inventory_transactions',
    'inventory_items',
    'company_tasks',
    'workflow_requests',
    'customer_incidents',
    'sales_orders',
    'sales_quotations',
    'sales_contracts'
  ];

  for (const t of tablesToTruncate) {
    try {
      await pool.query(`TRUNCATE TABLE ${t} RESTART IDENTITY CASCADE`);
      console.log(`Truncated table: ${t}`);
    } catch (err) {
      console.log(`Note for table ${t}: ${err.message}`);
    }
  }

  // Check remaining app_storage
  const remaining = await pool.query('SELECT key FROM app_storage');
  console.log('Remaining keys in app_storage:', remaining.rows.map(r => r.key));

  // Check preserved users and personnel
  const users = await pool.query('SELECT count(*) FROM users');
  const personnel = await pool.query('SELECT count(*) FROM personnel');
  console.log(`Preserved users count: ${users.rows[0].count}`);
  console.log(`Preserved personnel count: ${personnel.rows[0].count}`);

  await pool.end();
  console.log('--- DATABASE CLEAN COMPLETE ---');
}

main().catch(err => {
  console.error('Database clean error:', err);
  process.exit(1);
});
