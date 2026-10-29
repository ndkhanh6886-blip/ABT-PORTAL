const { Client } = require('pg');
const client = new Client({
  connectionString: process.env.DATABASE_URL || `postgresql://${process.env.PGUSER || 'postgres'}:${encodeURIComponent(process.env.PGPASSWORD || '')}@${process.env.PGHOST || '127.0.0.1'}:${process.env.PGPORT || '5432'}/${process.env.PGDATABASE || 'abt_portal'}`
});

async function run() {
  await client.connect();
  const res = await client.query("SELECT id, results_summary FROM workflow_requests WHERE workflow_code = 'WF-PROC-8248'");
  if (res.rows.length > 0) {
    let items = [];
    try {
      items = JSON.parse(res.rows[0].results_summary);
    } catch (e) {}
    items = items.map(it => ({
      ...it,
      estimated_price: 55000000,
      unit_price: 55000000
    }));
    await client.query("UPDATE workflow_requests SET results_summary = $1 WHERE workflow_code = 'WF-PROC-8248'", [JSON.stringify(items)]);
    console.log("Updated WF-PROC-8248 successfully:", items);
  }
  await client.end();
}

run().catch(console.error);
