/*
 * MySQL 驱动（上线用）：本地开发装不上 npm 包也没关系 —— 只有 DB_DRIVER=mysql 时才会走到这里。
 * 需要先 npm i mysql2（云服务器上装）。
 *
 * 和 SQLite 驱动暴露同一套接口（all/get/run/exec/transaction），业务层代码一行都不用改。
 */

function open(config) {
  let mysql;
  try {
    mysql = require('mysql2/promise');
  } catch (e) {
    throw new Error('切换 MySQL 需要先安装驱动：npm i mysql2');
  }

  const options = {
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.mysql.database,
    charset: 'utf8mb4',
    dateStrings: true,
    waitForConnections: true,
    connectionLimit: config.mysql.connectionLimit,
    queueLimit: 0,
    multipleStatements: false
  };

  const pool = mysql.createPool(options);

  const api = {
    driver: 'mysql',
    location: config.mysql.host + ':' + config.mysql.port + '/' + config.mysql.database,

    async exec(sql) {
      await pool.query(sql);
    },

    async all(sql, params) {
      const [rows] = await pool.query(sql, params || []);
      return rows;
    },

    async get(sql, params) {
      const rows = await api.all(sql, params);
      return rows.length > 0 ? rows[0] : null;
    },

    async run(sql, params) {
      const [result] = await pool.query(sql, params || []);
      return {
        lastId: Number(result.insertId || 0),
        changes: Number(result.affectedRows || 0)
      };
    },

    // 事务用一条独占连接，保证接单/下单这种多步写入不会互相打架
    async transaction(fn) {
      const conn = await pool.getConnection();
      const tx = {
        driver: 'mysql',
        location: api.location,
        async exec(sql) { await conn.query(sql); },
        async all(sql, params) {
          const [rows] = await conn.query(sql, params || []);
          return rows;
        },
        async get(sql, params) {
          const rows = await tx.all(sql, params);
          return rows.length > 0 ? rows[0] : null;
        },
        async run(sql, params) {
          const [result] = await conn.query(sql, params || []);
          return {
            lastId: Number(result.insertId || 0),
            changes: Number(result.affectedRows || 0)
          };
        }
      };

      try {
        await conn.beginTransaction();
        const out = await fn(tx);
        await conn.commit();
        return out;
      } catch (e) {
        try { await conn.rollback(); } catch (ignored) { /* 回滚失败按原错误抛 */ }
        throw e;
      } finally {
        conn.release();
      }
    },

    async close() {
      await pool.end();
    }
  };

  return api;
}

// 首次部署：库还不存在时先建库（连的时候先不指定 database）
async function bootstrap(config) {
  let mysql;
  try {
    mysql = require('mysql2/promise');
  } catch (e) {
    throw new Error('切换 MySQL 需要先安装驱动：npm i mysql2');
  }
  const conn = await mysql.createConnection({
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    charset: 'utf8mb4'
  });
  try {
    await conn.query(
      'CREATE DATABASE IF NOT EXISTS `' + config.mysql.database + '` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci'
    );
  } finally {
    await conn.end();
  }
}

module.exports = { open, bootstrap };
