/*
 * SQLite 驱动（开发默认）：一个文件就是整个「库」，对应 Qt 版那个 SQLite 文件。
 * 用 Node 24 自带的 node:sqlite，不需要 npm 装任何东西。
 *
 * 驱动接口统一是异步的（因为 MySQL 驱动本来就是异步），业务层只认 all/get/run/transaction。
 */

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// node:sqlite 只接受 null / number / string / bigint / Uint8Array
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
  /*
   * 开库先合并一次 WAL（对应"数据不该全躺在 tutor.db-wal 里"这条）。
   * 开发时后端常被强杀（「停止后端.cmd」、直接关窗口、杀进程），SQLite 没机会做 checkpoint，
   * 主库 tutor.db 会一直停在几 KB，全部数据留在 WAL 里 —— WAL 一丢数据就没了。
   * TRUNCATE 模式合并完顺手把 WAL 清空；失败（比如另一个实例正在写、或者只读打开）不影响启动。
   */
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (e) {
    // 合并不了就算了，后端照常起
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

    // 事务：接单这种「先抢单再写订单」必须原子完成（对应原来内存版的先查后写）
    async transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const out = await fn(api);
        db.exec('COMMIT');
        return out;
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch (ignored) { /* 已经回滚过就算了 */ }
        throw e;
      }
    },

    async close() {
      // 正常关库前再合并一次（被强杀就走不到这里，所以开库时那次才是主要保障）
      try {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      } catch (e) {
        // 关库前的合并失败不影响关闭
      }
      db.close();
    }
  };

  return api;
}

module.exports = { open };
