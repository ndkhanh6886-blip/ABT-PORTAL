const { Pool } = require('pg');

async function cleanStorage() {
  const pool = new Pool({
    host: '127.0.0.1',
    user: 'postgres',
    password: process.env.PGPASSWORD,
    database: 'tbrs_portal',
    port: 5432
  });

  const badCodes = new Set([
    'DG-LIS-LAB', 'EQ-EXTRACT-32', 'EQ-QPCR-96', 'CS-TIP-FILTER',
    'LBC-021', 'EXS-021', 'EXS-022', 'SQH-115.A', 'SQH-115.B', 'SQH-116.A', 'SQH-116.B'
  ]);

  const res = await pool.query("SELECT data FROM app_storage WHERE key = 'sales_commercial_products'");
  if (res.rows.length > 0) {
    const cur = res.rows[0].data || [];
    const cleaned = cur.filter((x) => !badCodes.has(x.code));
    await pool.query("UPDATE app_storage SET data = $1 WHERE key = 'sales_commercial_products'", [JSON.stringify(cleaned)]);
    console.log(`Cleaned sales_commercial_products: ${cur.length} -> ${cleaned.length} items`);
  }
  await pool.end();
}

cleanStorage().catch(console.error);
