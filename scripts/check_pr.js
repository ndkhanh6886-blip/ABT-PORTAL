const { Client } = require('pg');
const client = new Client({
  connectionString: process.env.DATABASE_URL || `postgresql://${process.env.PGUSER || 'postgres'}:${encodeURIComponent(process.env.PGPASSWORD || '')}@${process.env.PGHOST || '127.0.0.1'}:${process.env.PGPORT || '5432'}/${process.env.PGDATABASE || 'abt_portal'}`
});

async function run() {
  await client.connect();
  const res = await client.query("SELECT id, workflow_code, title, product_info, results_summary, description FROM workflow_requests WHERE workflow_code = 'WF-PROC-8248' OR workflow_code LIKE 'WF-PROC%' ORDER BY id DESC LIMIT 5");
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
}

run().catch(console.error);
