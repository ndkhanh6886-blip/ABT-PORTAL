const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: process.env.PGPASSWORD, database: 'abt_portal' });

async function check() {
  const codes = [
    'BIO-21040', 'BIO-21052', 'BIO-21060', 'BIO-21105', 'BIO-21106',
    'S816-100L', 'G213.SIZE.100g', 'SD7002.SIZE.250g', 'SD7003.SIZE.250g',
    'GRM038-100G', 'CB3060.SIZE.100g', 'GM078-500G', 'GM091-500G', 'GM096-500G', 'GRM031-500G',
    '1003171000', '1003271000', '1005731000', '1007311000', 'M5800-50L'
  ];

  for (const c of codes) {
    const inv = await pool.query('SELECT count(*) FROM inventory_items WHERE product_code = $1', [c]);
    const orders = await pool.query('SELECT count(*) FROM sales_orders WHERE items::text ILIKE $1', [`%${c}%`]);
    const pc = await pool.query('SELECT count(*) FROM product_components WHERE parent_product_code = $1', [c]);
    console.log(`${c} -> inv: ${inv.rows[0].count}, orders: ${orders.rows[0].count}, comp: ${pc.rows[0].count}`);
  }

  // Delete all 20 of these mock chemicals from products!
  const del = await pool.query('DELETE FROM products WHERE code = ANY($1)', [codes]);
  console.log(`DELETED ${del.rowCount} mock chemicals from products table!`);

  const remaining = await pool.query('SELECT code, name, category FROM products ORDER BY code ASC');
  console.log('REMAINING REAL PRODUCTS:', remaining.rows);

  await pool.end();
}

check();
