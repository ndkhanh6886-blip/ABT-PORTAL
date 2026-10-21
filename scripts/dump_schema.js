const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  user: 'postgres',
  password: process.env.PGPASSWORD,
  database: 'tbrs_portal'
});

async function main() {
  const tablesRes = await pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);

  let schemaSql = `-- Auto-generated complete database schema for TBR & VIA Portal\n\n`;

  for (const { table_name } of tablesRes.rows) {
    if (table_name === 'inventory_items_backup') continue;

    const colsRes = await pool.query(`
      SELECT column_name, data_type, udt_name, character_maximum_length, column_default, is_nullable
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [table_name]);

    const colDefs = colsRes.rows.map(col => {
      let type = col.data_type.toUpperCase();
      if (type === 'CHARACTER VARYING') {
        type = col.character_maximum_length ? `VARCHAR(${col.character_maximum_length})` : 'VARCHAR(255)';
      } else if (type === 'USER-DEFINED') {
        type = col.udt_name.toUpperCase();
      }
      
      let def = `  "${col.column_name}" ${type}`;
      if (col.column_default) {
        if (col.column_default.startsWith('nextval')) {
          def = `  "${col.column_name}" SERIAL`;
        } else {
          def += ` DEFAULT ${col.column_default}`;
        }
      }
      if (col.is_nullable === 'NO' && !col.column_default?.startsWith('nextval')) {
        def += ` NOT NULL`;
      }
      return def;
    });

    // Primary key check
    const pkRes = await pool.query(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = $1
    `, [table_name]);

    if (pkRes.rows.length > 0) {
      colDefs.push(`  PRIMARY KEY ("${pkRes.rows[0].column_name}")`);
    }

    schemaSql += `CREATE TABLE IF NOT EXISTS "${table_name}" (\n${colDefs.join(',\n')}\n);\n\n`;
  }

  fs.writeFileSync('src/backend/db/schema.sql', schemaSql);
  console.log('Schema written to src/backend/db/schema.sql. Total tables:', tablesRes.rows.length);
  await pool.end();
}

main().catch(console.error);
