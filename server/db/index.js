const schema = require('./schema.js');

async function openDatabase(config) {
  let db;
  if (config.dbDriver === 'mysql') {
    const mysqlDriver = require('./mysql.js');
    await mysqlDriver.bootstrap(config);
    db = mysqlDriver.open(config);
  } else {
    db = require('./sqlite.js').open(config);
  }

  await schema.migrate(db);
  await schema.seed(db, config);
  return db;
}

module.exports = { openDatabase };
