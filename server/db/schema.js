const util = require('../lib/util.js');

const SQLITE_DDL = [
  `CREATE TABLE IF NOT EXISTS teachers (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL DEFAULT '',
     password TEXT NOT NULL DEFAULT '',
     subject TEXT NOT NULL DEFAULT '',
     price TEXT NOT NULL DEFAULT '',
     intro TEXT NOT NULL DEFAULT '',
     rating REAL NOT NULL DEFAULT 5,
     education TEXT NOT NULL DEFAULT '',
     school TEXT NOT NULL DEFAULT '',
     years TEXT NOT NULL DEFAULT '',
     certificate TEXT NOT NULL DEFAULT '',
     times TEXT NOT NULL DEFAULT '',
     area TEXT NOT NULL DEFAULT '',
     lat REAL NOT NULL DEFAULT 0,
     lng REAL NOT NULL DEFAULT 0,
     gender TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT ''
   )`,
  `CREATE TABLE IF NOT EXISTS students (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL DEFAULT '',
     password TEXT NOT NULL DEFAULT '',
     school TEXT NOT NULL DEFAULT '',
     grade TEXT NOT NULL DEFAULT '',
     phone TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT ''
   )`,
  `CREATE TABLE IF NOT EXISTS bookings (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     teacher_id INTEGER NOT NULL,
     student_id INTEGER NOT NULL DEFAULT 0,
     post_id INTEGER NOT NULL DEFAULT 0,
     day TEXT NOT NULL DEFAULT '',
     period TEXT NOT NULL DEFAULT '',
     remark TEXT NOT NULL DEFAULT '',
     student_name TEXT NOT NULL DEFAULT '',
     price TEXT NOT NULL DEFAULT '',
     resume TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT ''
   )`,
  `CREATE TABLE IF NOT EXISTS messages (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     title TEXT NOT NULL DEFAULT '',
     body TEXT NOT NULL DEFAULT '',
     student_id INTEGER NOT NULL DEFAULT 0,
     teacher_id INTEGER NOT NULL DEFAULT 0,
     sender_type TEXT NOT NULL DEFAULT 'system',
     agent_id INTEGER NOT NULL DEFAULT 0,
     kind TEXT NOT NULL DEFAULT 'system',
     contract_url TEXT NOT NULL DEFAULT '',
     is_read INTEGER NOT NULL DEFAULT 0,
     external_id TEXT,
     post_id INTEGER NOT NULL DEFAULT 0,
     booking_id INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT ''
   )`,
  `CREATE TABLE IF NOT EXISTS reviews (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     student_id INTEGER NOT NULL,
     teacher_id INTEGER NOT NULL,
     rating INTEGER NOT NULL DEFAULT 0,
     content TEXT NOT NULL DEFAULT '',
     reply TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT '',
     replied_at TEXT NOT NULL DEFAULT ''
  )`,

  `CREATE TABLE IF NOT EXISTS corrections (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     actor_role TEXT NOT NULL DEFAULT '',
     actor_id INTEGER NOT NULL DEFAULT 0,
     target TEXT NOT NULL DEFAULT '',
     target_id INTEGER NOT NULL DEFAULT 0,
     from_status TEXT NOT NULL DEFAULT '',
     to_status TEXT NOT NULL DEFAULT '',
     note TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT ''
   )`,
  `CREATE TABLE IF NOT EXISTS posts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     code TEXT NOT NULL DEFAULT '',
     publisher_role TEXT NOT NULL DEFAULT '',
     publisher_id INTEGER NOT NULL DEFAULT 0,
     publisher_name TEXT NOT NULL DEFAULT '',
     subject TEXT NOT NULL DEFAULT '',
     grade TEXT NOT NULL DEFAULT '',
     gender TEXT NOT NULL DEFAULT '',
     day TEXT NOT NULL DEFAULT '',
     period TEXT NOT NULL DEFAULT '',
     price TEXT NOT NULL DEFAULT '',
     area TEXT NOT NULL DEFAULT '',
     lat REAL NOT NULL DEFAULT 0,
     lng REAL NOT NULL DEFAULT 0,
     note TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL DEFAULT '',
     source TEXT NOT NULL DEFAULT 'manual',
     external_id TEXT,
     batch_id TEXT NOT NULL DEFAULT '',
     requirements TEXT NOT NULL DEFAULT '',
     raw_text TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT '',
     taker_role TEXT NOT NULL DEFAULT '',
     taker_id INTEGER NOT NULL DEFAULT 0,
     booking_id INTEGER NOT NULL DEFAULT 0,
     taken_at TEXT NOT NULL DEFAULT ''
   )`,
  `CREATE TABLE IF NOT EXISTS chats (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     student_id INTEGER NOT NULL,
     teacher_id INTEGER NOT NULL,
     agent_id INTEGER NOT NULL DEFAULT 0,
     sender_role TEXT NOT NULL DEFAULT '',
     sender_type TEXT NOT NULL DEFAULT 'user',
     body TEXT NOT NULL DEFAULT '',
     is_read INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT ''
  )`,

  `CREATE TABLE IF NOT EXISTS lessons (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     booking_id INTEGER NOT NULL DEFAULT 0,
     kind TEXT NOT NULL DEFAULT '',
     seq INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT '',
     result TEXT NOT NULL DEFAULT '',
     fee INTEGER NOT NULL DEFAULT 0,
     content TEXT NOT NULL DEFAULT '',
     reason TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT '',
     confirmed_at TEXT NOT NULL DEFAULT '',
     paid_at TEXT NOT NULL DEFAULT ''
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     token_hash TEXT NOT NULL,
     role TEXT NOT NULL DEFAULT '',
     account_id INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT '',
     expires_at TEXT NOT NULL DEFAULT ''
   )`,
  `CREATE TABLE IF NOT EXISTS wx_bindings (
     openid TEXT PRIMARY KEY,
     role TEXT NOT NULL DEFAULT '',
     account_id INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT ''
   )`,

  `CREATE TABLE IF NOT EXISTS agents (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL DEFAULT '',
     avatar TEXT NOT NULL DEFAULT '',
     intro TEXT NOT NULL DEFAULT '',
     owner_student_id INTEGER NOT NULL DEFAULT 0,
     is_official INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL DEFAULT ''
   )`,

  `CREATE TABLE IF NOT EXISTS agent_tokens (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     token_hash TEXT NOT NULL,
     agent_id INTEGER NOT NULL DEFAULT 0,
     student_id INTEGER NOT NULL DEFAULT 0,
     label TEXT NOT NULL DEFAULT '',
     revoked INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT '',
     last_used_at TEXT NOT NULL DEFAULT ''
   )`,

  `CREATE TABLE IF NOT EXISTS agent_events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     type TEXT NOT NULL DEFAULT '',
     payload TEXT NOT NULL DEFAULT '',
     ref_id INTEGER NOT NULL DEFAULT 0,
     student_id INTEGER NOT NULL DEFAULT 0,
     teacher_id INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT 'pending',
     attempts INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT '',
     delivered_at TEXT NOT NULL DEFAULT ''
   )`,

  `CREATE TABLE IF NOT EXISTS payments (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     booking_id INTEGER NOT NULL DEFAULT 0,
     teacher_id INTEGER NOT NULL DEFAULT 0,
     student_id INTEGER NOT NULL DEFAULT 0,
     kind TEXT NOT NULL DEFAULT 'charge',
     amount INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT '',
     method TEXT NOT NULL DEFAULT '',
     note TEXT NOT NULL DEFAULT '',
     contract_url TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT '',
     updated_at TEXT NOT NULL DEFAULT ''
   )`,
  `CREATE INDEX IF NOT EXISTS idx_bookings_student ON bookings (student_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bookings_teacher ON bookings (teacher_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bookings_post ON bookings (post_id)`,
  `CREATE INDEX IF NOT EXISTS idx_lessons_booking ON lessons (booking_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chats_pair ON chats (student_id, teacher_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reviews_teacher ON reviews (teacher_id)`,
  `CREATE INDEX IF NOT EXISTS idx_posts_status ON posts (status)`,
  `CREATE INDEX IF NOT EXISTS idx_posts_code ON posts (code)`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_external ON posts (external_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (token_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_tokens_hash ON agent_tokens (token_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_events_status ON agent_events (status)`,
  `CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments (booking_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chats_agent ON chats (teacher_id, agent_id)`
];

const MYSQL_DDL = [
  `CREATE TABLE IF NOT EXISTS teachers (
     id INT AUTO_INCREMENT PRIMARY KEY,
     name VARCHAR(64) NOT NULL DEFAULT '',
     password VARCHAR(64) NOT NULL DEFAULT '',
     subject VARCHAR(32) NOT NULL DEFAULT '',
     price VARCHAR(64) NOT NULL DEFAULT '',
     intro TEXT,
     rating DOUBLE NOT NULL DEFAULT 5,
     education VARCHAR(64) NOT NULL DEFAULT '',
     school VARCHAR(128) NOT NULL DEFAULT '',
     years VARCHAR(32) NOT NULL DEFAULT '',
     certificate TEXT,
     times TEXT,
     area VARCHAR(255) NOT NULL DEFAULT '',
     lat DOUBLE NOT NULL DEFAULT 0,
     lng DOUBLE NOT NULL DEFAULT 0,
     gender VARCHAR(16) NOT NULL DEFAULT '',
     created_at VARCHAR(32) NOT NULL DEFAULT ''
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS students (
     id INT AUTO_INCREMENT PRIMARY KEY,
     name VARCHAR(64) NOT NULL DEFAULT '',
     password VARCHAR(64) NOT NULL DEFAULT '',
     school VARCHAR(128) NOT NULL DEFAULT '',
     grade VARCHAR(64) NOT NULL DEFAULT '',
     phone VARCHAR(32) NOT NULL DEFAULT '',
     created_at VARCHAR(32) NOT NULL DEFAULT ''
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS bookings (
     id INT AUTO_INCREMENT PRIMARY KEY,
     teacher_id INT NOT NULL,
     student_id INT NOT NULL DEFAULT 0,
     post_id INT NOT NULL DEFAULT 0,
     day VARCHAR(64) NOT NULL DEFAULT '',
     period VARCHAR(32) NOT NULL DEFAULT '',
     remark TEXT,
     student_name VARCHAR(64) NOT NULL DEFAULT '',
     price VARCHAR(64) NOT NULL DEFAULT '',
     resume TEXT,
     status VARCHAR(16) NOT NULL DEFAULT '',
     created_at VARCHAR(32) NOT NULL DEFAULT ''
     ,INDEX idx_bookings_post (post_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS messages (
     id INT AUTO_INCREMENT PRIMARY KEY,
     title VARCHAR(128) NOT NULL DEFAULT '',
     body TEXT,
     student_id INT NOT NULL DEFAULT 0,
     teacher_id INT NOT NULL DEFAULT 0,
     sender_type VARCHAR(16) NOT NULL DEFAULT 'system',
     agent_id INT NOT NULL DEFAULT 0,
     kind VARCHAR(16) NOT NULL DEFAULT 'system',
     contract_url VARCHAR(512) NOT NULL DEFAULT '',
     is_read INT NOT NULL DEFAULT 0,
     external_id VARCHAR(64) DEFAULT NULL,
     post_id INT NOT NULL DEFAULT 0,
     booking_id INT NOT NULL DEFAULT 0,
     created_at VARCHAR(32) NOT NULL DEFAULT ''
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS reviews (
     id INT AUTO_INCREMENT PRIMARY KEY,
     student_id INT NOT NULL,
     teacher_id INT NOT NULL,
     rating INT NOT NULL DEFAULT 0,
     content TEXT,
     reply TEXT,
     created_at VARCHAR(32) NOT NULL DEFAULT '',
     replied_at VARCHAR(32) NOT NULL DEFAULT ''
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS corrections (
     id INT AUTO_INCREMENT PRIMARY KEY,
     actor_role VARCHAR(16) NOT NULL DEFAULT '',
     actor_id INT NOT NULL DEFAULT 0,
     target VARCHAR(16) NOT NULL DEFAULT '',
     target_id INT NOT NULL DEFAULT 0,
     from_status VARCHAR(32) NOT NULL DEFAULT '',
     to_status VARCHAR(32) NOT NULL DEFAULT '',
     note VARCHAR(255) NOT NULL DEFAULT '',
     created_at VARCHAR(32) NOT NULL DEFAULT '',
     INDEX idx_corrections_target (target, target_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS posts (
     id INT AUTO_INCREMENT PRIMARY KEY,
     code VARCHAR(32) NOT NULL DEFAULT '',
     publisher_role VARCHAR(16) NOT NULL DEFAULT '',
     publisher_id INT NOT NULL DEFAULT 0,
     publisher_name VARCHAR(64) NOT NULL DEFAULT '',
     subject VARCHAR(32) NOT NULL DEFAULT '',
     grade VARCHAR(32) NOT NULL DEFAULT '',
     gender VARCHAR(16) NOT NULL DEFAULT '',
     day VARCHAR(64) NOT NULL DEFAULT '',
     period VARCHAR(32) NOT NULL DEFAULT '',
     price VARCHAR(64) NOT NULL DEFAULT '',
     area VARCHAR(255) NOT NULL DEFAULT '',
     lat DOUBLE NOT NULL DEFAULT 0,
     lng DOUBLE NOT NULL DEFAULT 0,
     note TEXT,
     status VARCHAR(16) NOT NULL DEFAULT '',
     source VARCHAR(16) NOT NULL DEFAULT 'manual',
     external_id VARCHAR(64) DEFAULT NULL,
     batch_id VARCHAR(64) NOT NULL DEFAULT '',
     requirements TEXT,
     raw_text TEXT,
     created_at VARCHAR(32) NOT NULL DEFAULT '',
     taker_role VARCHAR(16) NOT NULL DEFAULT '',
     taker_id INT NOT NULL DEFAULT 0,
     booking_id INT NOT NULL DEFAULT 0,
     taken_at VARCHAR(32) NOT NULL DEFAULT '',
     INDEX idx_posts_code (code),
     UNIQUE KEY uniq_posts_external (external_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS chats (
     id INT AUTO_INCREMENT PRIMARY KEY,
     student_id INT NOT NULL,
     teacher_id INT NOT NULL,
     agent_id INT NOT NULL DEFAULT 0,
     sender_role VARCHAR(16) NOT NULL DEFAULT '',
     sender_type VARCHAR(16) NOT NULL DEFAULT 'user',
     body TEXT,
     is_read INT NOT NULL DEFAULT 0,
     created_at VARCHAR(32) NOT NULL DEFAULT '',
     INDEX idx_chats_pair (student_id, teacher_id),
     INDEX idx_chats_agent (teacher_id, agent_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS lessons (
     id INT AUTO_INCREMENT PRIMARY KEY,
     booking_id INT NOT NULL DEFAULT 0,
     kind VARCHAR(16) NOT NULL DEFAULT '',
     seq INT NOT NULL DEFAULT 0,
     status VARCHAR(16) NOT NULL DEFAULT '',
     result VARCHAR(16) NOT NULL DEFAULT '',
     fee INT NOT NULL DEFAULT 0,
     content TEXT,
     reason TEXT,
     created_at VARCHAR(32) NOT NULL DEFAULT '',
     confirmed_at VARCHAR(32) NOT NULL DEFAULT '',
     paid_at VARCHAR(32) NOT NULL DEFAULT '',
     INDEX idx_lessons_booking (booking_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS sessions (
     id INT AUTO_INCREMENT PRIMARY KEY,
     token_hash VARCHAR(64) NOT NULL,
     role VARCHAR(16) NOT NULL DEFAULT '',
     account_id INT NOT NULL DEFAULT 0,
     created_at VARCHAR(32) NOT NULL DEFAULT '',
     expires_at VARCHAR(32) NOT NULL DEFAULT '',
     INDEX idx_sessions_token (token_hash)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS wx_bindings (
     openid VARCHAR(64) PRIMARY KEY,
     role VARCHAR(16) NOT NULL DEFAULT '',
     account_id INT NOT NULL DEFAULT 0,
     created_at VARCHAR(32) NOT NULL DEFAULT ''
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS agents (
     id INT AUTO_INCREMENT PRIMARY KEY,
     name VARCHAR(64) NOT NULL DEFAULT '',
     avatar VARCHAR(64) NOT NULL DEFAULT '',
     intro VARCHAR(255) NOT NULL DEFAULT '',
     owner_student_id INT NOT NULL DEFAULT 0,
     is_official INT NOT NULL DEFAULT 1,
     created_at VARCHAR(32) NOT NULL DEFAULT ''
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS agent_tokens (
     id INT AUTO_INCREMENT PRIMARY KEY,
     token_hash VARCHAR(64) NOT NULL,
     agent_id INT NOT NULL DEFAULT 0,
     student_id INT NOT NULL DEFAULT 0,
     label VARCHAR(64) NOT NULL DEFAULT '',
     revoked INT NOT NULL DEFAULT 0,
     created_at VARCHAR(32) NOT NULL DEFAULT '',
     last_used_at VARCHAR(32) NOT NULL DEFAULT '',
     INDEX idx_agent_tokens_hash (token_hash)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS agent_events (
     id INT AUTO_INCREMENT PRIMARY KEY,
     type VARCHAR(32) NOT NULL DEFAULT '',
     payload TEXT,
     ref_id INT NOT NULL DEFAULT 0,
     student_id INT NOT NULL DEFAULT 0,
     teacher_id INT NOT NULL DEFAULT 0,
     status VARCHAR(16) NOT NULL DEFAULT 'pending',
     attempts INT NOT NULL DEFAULT 0,
     created_at VARCHAR(32) NOT NULL DEFAULT '',
     delivered_at VARCHAR(32) NOT NULL DEFAULT '',
     INDEX idx_agent_events_status (status)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS payments (
     id INT AUTO_INCREMENT PRIMARY KEY,
     booking_id INT NOT NULL DEFAULT 0,
     teacher_id INT NOT NULL DEFAULT 0,
     student_id INT NOT NULL DEFAULT 0,
     kind VARCHAR(16) NOT NULL DEFAULT 'charge',
     amount INT NOT NULL DEFAULT 0,
     status VARCHAR(16) NOT NULL DEFAULT '',
     method VARCHAR(32) NOT NULL DEFAULT '',
     note VARCHAR(255) NOT NULL DEFAULT '',
     contract_url VARCHAR(512) NOT NULL DEFAULT '',
     created_at VARCHAR(32) NOT NULL DEFAULT '',
     updated_at VARCHAR(32) NOT NULL DEFAULT '',
     INDEX idx_payments_booking (booking_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
];

const DEMO_TEACHERS = [
  ['王数学', '数学', '99 元/小时'],
  ['李英语', '英语', '88 元/小时'],
  ['张物理', '物理', '77 元/小时']
];

async function ensureColumns(db) {
  const mysql = db.driver === 'mysql';
  const text = mysql ? 'VARCHAR(255) NOT NULL DEFAULT \'\'' : "TEXT NOT NULL DEFAULT ''";
  const short = mysql ? 'VARCHAR(64) NOT NULL DEFAULT \'\'' : "TEXT NOT NULL DEFAULT ''";
  const nullText = mysql ? 'VARCHAR(64) DEFAULT NULL' : 'TEXT';
  const score = mysql ? 'INT NOT NULL DEFAULT 0' : 'INTEGER NOT NULL DEFAULT 0';
  const additions = [
    ['bookings', 'resume', mysql ? 'TEXT' : "TEXT NOT NULL DEFAULT ''"],

    ['bookings', 'post_id', score],

    ['teachers', 'education', text],
    ['teachers', 'school', text],
    ['teachers', 'years', text],
    ['teachers', 'certificate', text],
    ['teachers', 'times', text],

    ['lessons', 'fee', score],

    ['posts', 'code', short],
    ['posts', 'source', short],
    ['posts', 'external_id', nullText],
    ['posts', 'batch_id', short],

    ['posts', 'grade', short],
    ['posts', 'gender', short],

    ['posts', 'requirements', mysql ? 'TEXT' : "TEXT NOT NULL DEFAULT ''"],

    ['posts', 'raw_text', mysql ? 'TEXT' : "TEXT NOT NULL DEFAULT ''"],

    ['teachers', 'gender', short],

    ['messages', 'sender_type', short],
    ['messages', 'agent_id', score],
    ['messages', 'kind', short],
    ['messages', 'contract_url', mysql ? 'VARCHAR(512) NOT NULL DEFAULT \'\'' : "TEXT NOT NULL DEFAULT ''"],
    ['messages', 'is_read', score],
    ['messages', 'external_id', nullText],

    ['messages', 'post_id', score],

    ['messages', 'booking_id', score],

    ['chats', 'agent_id', score],
    ['chats', 'sender_type', short]
  ];
  for (const [table, column, type] of additions) {
    try {
      await db.run('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + type);
    } catch (e) {

    }
  }
}

async function migrate(db) {

  await ensureColumns(db);
  const list = db.driver === 'mysql' ? MYSQL_DDL : SQLITE_DDL;
  for (const sql of list) {
    await db.exec(sql);
  }
  await migrateStatuses(db);
}

async function migrateStatuses(db) {
  try {
    await db.run(
      'UPDATE bookings SET status = ? WHERE status IN (?, ?)',
      ['主订单进行中', '已确认', '已预约']
    );
  } catch (e) {

  }
}

async function seed(db, config) {
  if (!config || config.seedDemo === false) return;
  const row = await db.get('SELECT COUNT(*) AS total FROM teachers');
  if (row && Number(row.total) > 0) return;

  for (const [name, subject, price] of DEMO_TEACHERS) {
    await db.run(
      `INSERT INTO teachers (name, password, subject, price, intro, rating, area, lat, lng, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        util.hashPassword(util.DEFAULT_PASSWORD),
        subject,
        price,
        name + '老师，擅长' + subject + '辅导，' + util.DEFAULT_INTRO,
        5.0,
        '',
        0,
        0,
        util.nowText()
      ]
    );
  }
}

module.exports = { migrate, seed, SQLITE_DDL, MYSQL_DDL, DEMO_TEACHERS };
