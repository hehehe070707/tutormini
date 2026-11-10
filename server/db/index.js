/*
 * 数据库门面：按配置选驱动（SQLite / MySQL），建表 + 首次示例数据。
 * 业务层只拿到 { driver, all, get, run, exec, transaction, close } 这一套接口。
 */

const schema = require('./schema.js');

async function openDatabase(config) {
  let db;
  if (config.dbDriver === 'mysql') {
    const mysqlDriver = require('./mysql.js');
    await mysqlDriver.bootstrap(config);          // 库不存在就先建库
    db = mysqlDriver.open(config);
  } else {
    db = require('./sqlite.js').open(config);
  }

  await schema.migrate(db);
  await schema.seed(db, config);
  return db;
}

module.exports = { openDatabase };
