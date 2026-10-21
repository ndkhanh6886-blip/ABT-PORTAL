const { Client } = require('pg');
const client = new Client({
  connectionString: process.env.DATABASE_URL || `postgresql://${process.env.PGUSER || 'postgres'}:${encodeURIComponent(process.env.PGPASSWORD || '')}@${process.env.PGHOST || '127.0.0.1'}:${process.env.PGPORT || '5432'}/${process.env.PGDATABASE || 'tbrs_portal'}`
});

async function run() {
  await client.connect();
  const res = await client.query("SELECT id, code, name FROM products WHERE code = 'DG-LIS-LAB' OR code LIKE '%LIS%'");
  console.log("Found products:", JSON.stringify(res.rows, null, 2));
  await client.end();
}

run().catch(console.error);
