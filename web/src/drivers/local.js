// Hesapsız kullanım: veriler yalnızca bu tarayıcıda (IndexedDB) durur.
import { idbAll, idbPut, idbDelete, idbClear } from '../lib/idb.js';

export function createLocalDriver() {
  return {
    kind: 'local',
    all: (table) => idbAll(table),
    async insert(table, rows) {
      await idbPut(table, rows);
      return rows;
    },
    async update(table, id, patch) {
      const rows = await idbAll(table);
      const row = rows.find((r) => r.id === id);
      if (!row) return null;
      const next = { ...row, ...patch };
      await idbPut(table, [next]);
      return next;
    },
    async remove(table, id) {
      await idbDelete(table, [id]);
      if (table === 'sources') {
        const quotes = await idbAll('quotes');
        await idbDelete('quotes', quotes.filter((q) => q.source_id === id).map((q) => q.id));
      }
    },
    clear: () => idbClear(),
  };
}
