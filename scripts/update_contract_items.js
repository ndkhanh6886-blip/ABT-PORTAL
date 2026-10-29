const { Client } = require('pg');
const client = new Client({
  connectionString: process.env.DATABASE_URL || `postgresql://${process.env.PGUSER || 'postgres'}:${encodeURIComponent(process.env.PGPASSWORD || '')}@${process.env.PGHOST || '127.0.0.1'}:${process.env.PGPORT || '5432'}/${process.env.PGDATABASE || 'abt_portal'}`
});

async function run() {
  await client.connect();
  const items = [
    {
      productCode: 'DG-LIS-LAB',
      productName: 'Phần mềm Quản lý Xét nghiệm LIMS Cloud - ABT SmartLab',
      specification: 'Bản quyền vĩnh viễn + 1 năm cloud',
      quantity: 1,
      price: 55000000,
      total: 52250000,
      discountRate: 5,
      vatRate: 8
    }
  ];

  await client.query("UPDATE sales_contracts SET items = $1 WHERE contract_code = 'CTR-2026-001'", [JSON.stringify(items)]);
  console.log("Updated sales_contracts in DB successfully.");

  // Also update app_storage
  const res = await client.query("SELECT data FROM app_storage WHERE key = 'sales_contracts'");
  if (res.rows.length > 0) {
    let list = res.rows[0].data;
    if (typeof list === 'string') {
      try { list = JSON.parse(list); } catch (e) {}
    }
    if (Array.isArray(list)) {
      list = list.map(c => {
        if (c.id === 'CTR-2026-001' || c.contract_code === 'CTR-2026-001') {
          return { ...c, items };
        }
        return c;
      });
      await client.query("UPDATE app_storage SET data = $1 WHERE key = 'sales_contracts'", [JSON.stringify(list)]);
      console.log("Updated sales_contracts in app_storage successfully.");
    }
  }

  await client.end();
}

run().catch(console.error);
