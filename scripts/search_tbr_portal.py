import os
import psycopg2, sys
sys.stdout.reconfigure(encoding='utf-8')
conn = psycopg2.connect(host='127.0.0.1', port=5432, user='postgres', password=os.environ.get('PGPASSWORD', ''), database='abt_portal')
cur = conn.cursor()
cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public';")
tables = [r[0] for r in cur.fetchall()]
for t in tables:
    try:
        cur.execute(f"SELECT * FROM {t}")
        for r in cur.fetchall():
            s = str(r)
            if any(k in s for k in ['SO-2026-016', 'FOR-2026-054', 'FOR-2026-051', '806', 'SO-2026-004', 'SO-2026-003']):
                print(f"[{t}] Found match: {s[:250]}")
    except Exception as e:
        pass
print("Finished search in abt_portal.")
