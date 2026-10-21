const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: process.env.PGPASSWORD, database: 'tbrs_portal' });

async function check() {
  const codes = [
    'TBR-KIT-001', 'LBC-021', 'SQH-115.A', 'SQH-115.B', 'SQH-116.A', 'SQH-116.B',
    'EXS-021', 'EXS-022', 'EQ-EXTRACT-32', 'EQ-QPCR-96', 'DG-LIS-LAB', 'CS-TIP-FILTER'
  ];

  for (const c of codes) {
    const inv = await pool.query('SELECT count(*) FROM inventory_items WHERE product_code = $1', [c]);
    const orders = await pool.query('SELECT count(*) FROM sales_orders WHERE items::text ILIKE $1', ['%' + c + '%']);
    const pc = await pool.query('SELECT count(*) FROM product_components WHERE parent_product_code = $1', [c]);
    console.log(`${c} -> inventory: ${inv.rows[0].count}, sales_orders: ${orders.rows[0].count}, product_components: ${pc.rows[0].count}`);
  }
  await pool.end();
}
check();
