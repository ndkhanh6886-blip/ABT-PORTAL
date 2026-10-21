const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: process.env.PGPASSWORD, database: 'tbrs_portal' });

async function checkAll() {
  const dummyCodes = [
    'TBR-KIT-001', 'LBC-021', 'SQH-115.A', 'SQH-115.B', 'SQH-116.A', 'SQH-116.B',
    'EXS-021', 'EXS-022', 'EQ-EXTRACT-32', 'EQ-QPCR-96', 'DG-LIS-LAB', 'CS-TIP-FILTER'
  ];

  const tables = ['sales_quotations', 'sales_contracts', 'sales_orders', 'inventory_items', 'inventory_transactions', 'procurement_orders', 'product_components'];
  for (const t of tables) {
    try {
      const res = await pool.query(`SELECT count(*) FROM ${t} WHERE CAST(${t}.* AS text) ILIKE '%TBR-KIT-001%'`);
      console.log(`Table ${t}: ${res.rows[0].count} matches for TBR-KIT-001`);
    } catch (e) {
      console.log(`Table ${t}: error ${e.message}`);
    }
  }

  // Delete dummy products
  const del = await pool.query('DELETE FROM products WHERE code = ANY($1)', [dummyCodes]);
  console.log(`Deleted ${del.rowCount} dummy products from products table!`);

  // Count remaining products
  const remaining = await pool.query('SELECT count(*) FROM products');
  console.log(`Remaining real products: ${remaining.rows[0].count}`);

  await pool.end();
}
checkAll();
