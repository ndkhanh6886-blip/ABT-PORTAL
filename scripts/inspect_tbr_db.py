import os
import psycopg2, json, sys
sys.stdout.reconfigure(encoding='utf-8')

conn = psycopg2.connect(
    host="127.0.0.1",
    port=5432,
    user="postgres",
    password=os.environ.get('PGPASSWORD', ''),
    database="abt_portal"
)
cursor = conn.cursor()

cursor.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='sales_orders';")
cols = [c[0] for c in cursor.fetchall()]
print("sales_orders columns:", cols)

cursor.execute("SELECT * FROM sales_orders ORDER BY id DESC LIMIT 50;")
rows = cursor.fetchall()
print(f"\nTotal sales_orders (last 50):")
for r in rows:
    d = dict(zip(cols, r))
    print(f"ID: {d.get('id')} | Code: {d.get('order_code')} | Cust: {d.get('customer_name')} | Date: {d.get('order_date')} | Total: {d.get('total_amount')} | DeliveryStatus: {d.get('delivery_status')} | PayStatus: {d.get('payment_status')} | Notes: {d.get('notes')}")

# Also check app_storage table if it exists
cursor.execute("SELECT key, length(value::text) FROM app_storage;")
storage_rows = cursor.fetchall()
print("\napp_storage keys:")
for k, l in storage_rows:
    print(f"  {k} (length: {l})")
