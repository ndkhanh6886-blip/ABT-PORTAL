const { Pool } = require('pg');
const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  user: 'postgres',
  password: process.env.PGPASSWORD,
  database: 'tbrs_portal'
});

async function run() {
  try {
    // Ensure column exists
    await pool.query('ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS components JSONB DEFAULT \'[]\'::jsonb');

    const compRes = await pool.query('SELECT * FROM product_components');
    const itemsRes = await pool.query('SELECT * FROM inventory_items');

    for (const it of itemsRes.rows) {
      const matchedComps = compRes.rows.filter(c => c.parent_product_code === it.product_code);
      if (matchedComps.length > 0) {
        const components = matchedComps.map((c, idx) => {
          const lotSuffix = idx === 0 ? '-C1' : '-C2';
          let shelf = 'Kho Thường (Kệ K-01)';
          if (c.storage_condition && c.storage_condition.includes('2-8')) shelf = 'Tủ Mát TBR (Kệ TM-02)';
          else if (c.storage_condition && c.storage_condition.includes('-20')) shelf = 'Tủ Lạnh Âm TBR (Ngăn F-01)';

          return {
            component_code: c.component_code,
            component_name: c.component_name,
            specification: c.specification || 'Phụ kiện kèm theo bộ Kit',
            unit: c.unit || 'Đơn vị',
            quantity_per_kit: Number(c.quantity_per_kit) || 1,
            total_quantity: (Number(c.quantity_per_kit) || 1) * Number(it.quantity_on_hand),
            lot_number: it.lot_number ? `${it.lot_number}${lotSuffix}` : `L-COMP-${idx + 1}`,
            expiry_date: it.expiry_date || '2028-12-31',
            storage_condition: c.storage_condition,
            shelf_position: shelf,
            is_mandatory: c.is_mandatory !== false,
            notes: c.notes || 'Thành phần chuẩn kèm theo kit'
          };
        });

        await pool.query('UPDATE inventory_items SET components = $1 WHERE id = $2', [JSON.stringify(components), it.id]);
        console.log(`Updated item ID ${it.id} (${it.product_code}) with ${components.length} components`);
      }
    }
    console.log('Update completed successfully!');
  } catch (err) {
    console.error('Error in script:', err);
  } finally {
    await pool.end();
  }
}

run();
