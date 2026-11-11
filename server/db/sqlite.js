const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function normalize(params) {
  return (params || []).map((value) => {
    if (value === undefined) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value;
  });
}

function plainRow(row) {
  return row ? Object.assign({}, row) : row;
}

function open(config) {
  const file = config.sqliteFile;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');

  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (e) {

  }

  const api = {
    driver: 'sqlite',
    location: file,

    async exec(sql) {
      db.exec(sql);
    },

    async all(sql, params) {
      return db.prepare(sql).all(...normalize(params)).map(plainRow);
    },

    async get(sql, params) {
      return plainRow(db.prepare(sql).get(...normalize(params)));
    },

    async run(sql, params) {
      const result = db.prepare(sql).run(...normalize(params));
      return {
        lastId: Number(result.lastInsertRowid || 0),
        changes: Number(result.changes || 0)
      };
    },

    async transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const out = await fn(api);
        db.exec('COMMIT');
        return out;
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch (ignored) {  }
        throw e;
      }
    },

    async close() {

      try {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      } catch (e) {

      }
      db.close();
    }
  };

  return api;
}

module.exports = { open };
