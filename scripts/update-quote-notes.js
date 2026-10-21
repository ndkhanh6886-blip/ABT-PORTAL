const { Pool } = require('pg');

async function updateQuotesNoteTerms() {
  const pool = new Pool({
    host: '127.0.0.1',
    user: 'postgres',
    password: process.env.PGPASSWORD,
    database: 'tbrs_portal',
    port: 5432
  });

  // Get current company config note
  const cfgRes = await pool.query("SELECT data FROM app_storage WHERE key = 'sales_company_config'");
  const userNote = cfgRes.rows[0]?.data?.defaultQuoteNoteTerms || "Đơn giá đã bao gồm thuế VAT 10% và phí lắp đặt/vận chuyển ngoại tỉnh.";

  const res = await pool.query("SELECT data FROM app_storage WHERE key = 'sales_quotations'");
  if (res.rows.length > 0) {
    const quotes = res.rows[0].data || [];
    const updated = quotes.map(q => {
      if (!q.noteTerms || q.noteTerms.includes("chưa bao gồm thuế VAT")) {
        return { ...q, noteTerms: userNote };
      }
      return q;
    });
    await pool.query("UPDATE app_storage SET data = $1 WHERE key = 'sales_quotations'", [JSON.stringify(updated)]);
    console.log(`Updated ${updated.length} quotations with user setting noteTerms`);
  }
  await pool.end();
}

updateQuotesNoteTerms().catch(console.error);
