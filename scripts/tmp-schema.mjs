import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/welfare-store.sqlite', { readOnly: true });
try {
  const rows = db.prepare("SELECT key, value FROM store_settings").all();
  for (const r of rows) {
    if (r.key === 'posShortcutKeys') {
      console.log('posShortcutKeys:', JSON.stringify(JSON.parse(r.value)));
    }
  }
} finally { db.close(); }
