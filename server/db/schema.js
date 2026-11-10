/*
 * 建表 + 首次示例数据。
 *
 * 表结构和 Qt 版 databasemanager.cpp 里的 7 张表（teachers / students / bookings / messages /
 * reviews / posts / chats）+ sessions 一一对应，另外多一张 wx_bindings（openid ↔ 账号绑定，
 * 用来支持 wx.login 自动登录）。
 *
 * 两套 DDL：SQLite（开发）和 MySQL（上线）。字段名和含义完全一致，换库不用改业务代码。
 */

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
  /*
   * 修正记录：中介手动改单子 / 订单状态、补录订单、作废单子时各记一笔。
   * 只用于回溯（页面上「修正记录」那几行），不参与业务计算。
   */
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
  /*
   * 课次：每次上课（含试课）一条记录。
   *   kind   试课 / 正式
   *   seq    这是这条订单的第几次正式课（试课固定 0）
   *   status 待确认 / 已确认 / 待支付 / 已支付
   *   result 只有试课用：通过 / 不通过
   *   content 老师提交的上课情况；reason 平台有异议时填的原因
   *   fee    这条课次的课时费（整数元）：正式课＝订单价格快照，试课＝半价或全价
   */
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
  /*
   * 虚拟助手账号（外部 Agent 的「人设」）：名字 / 头像 / 简介 + 归属哪个学生账号。
   * 它不参与登录，只出现在消息中心和聊天会话里（老师看到的「官方助手」）。
   */
  `CREATE TABLE IF NOT EXISTS agents (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL DEFAULT '',
     avatar TEXT NOT NULL DEFAULT '',
     intro TEXT NOT NULL DEFAULT '',
     owner_student_id INTEGER NOT NULL DEFAULT 0,
     is_official INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL DEFAULT ''
   )`,
  // 外部 Agent 的访问令牌：库里只存摘要，绑定学生账号，可吊销
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
  // 事件钩子：关键节点先落库，配了 AGENT_WEBHOOK_URL 再异步 POST 给外部 Agent
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
  /*
   * 收款 / 退款：老师确认接单后，平台发合同 + 收款码，老师付款、平台确认收款，
   * 试课没上成走退款。amount 是整数元；kind = charge（收款）/ refund（退款）。
   */
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
  // 外部单号唯一：同一条外部单重复导入不会建出第二条（空值不算冲突）
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

// 首次建库写入的示例老师（对应原来 store.seedIfEmpty 的三位老师）
const DEMO_TEACHERS = [
  ['王数学', '数学', '99 元/小时'],
  ['李英语', '英语', '88 元/小时'],
  ['张物理', '物理', '77 元/小时']
];

/*
 * 后来才加的表字段：CREATE TABLE IF NOT EXISTS 不会改老表，所以这里补一次 ALTER TABLE。
 * 字段已经存在时会报错，直接忽略（老库每次启动都会走到这里）。
 */
async function ensureColumns(db) {
  const mysql = db.driver === 'mysql';
  const text = mysql ? 'VARCHAR(255) NOT NULL DEFAULT \'\'' : "TEXT NOT NULL DEFAULT ''";
  const short = mysql ? 'VARCHAR(64) NOT NULL DEFAULT \'\'' : "TEXT NOT NULL DEFAULT ''";
  const nullText = mysql ? 'VARCHAR(64) DEFAULT NULL' : 'TEXT';
  const score = mysql ? 'INT NOT NULL DEFAULT 0' : 'INTEGER NOT NULL DEFAULT 0';
  const additions = [
    ['bookings', 'resume', mysql ? 'TEXT' : "TEXT NOT NULL DEFAULT ''"],
    // 投递单挂在哪条发布单下面（0 = 老式的学生直接预约，没有单）
    ['bookings', 'post_id', score],
    // 老师简历（「我的简历」页）：学历 / 学校 / 教龄 / 证书 / 可教时段
    ['teachers', 'education', text],
    ['teachers', 'school', text],
    ['teachers', 'years', text],
    ['teachers', 'certificate', text],
    ['teachers', 'times', text],
    // 课次课时费（老库里的 lessons 没这一列）
    ['lessons', 'fee', score],
    // 发布单：单号 / 来源 / 外部单号（幂等）/ 批次
    ['posts', 'code', short],
    ['posts', 'source', short],
    ['posts', 'external_id', nullText],
    ['posts', 'batch_id', short],
    // 发布单：年级 / 对老师的性别要求（老师端筛单用）
    ['posts', 'grade', short],
    ['posts', 'gender', short],
    // 发布单：结构化要求（学历 / 学校 / 教龄 / 证书 / 性别 / 授课方式 / 预算），JSON 文本
    ['posts', 'requirements', mysql ? 'TEXT' : "TEXT NOT NULL DEFAULT ''"],
    // 发布单：家长原话（给外部 Agent 解析成上面的结构化要求；老师端只展示，不参与筛选）
    ['posts', 'raw_text', mysql ? 'TEXT' : "TEXT NOT NULL DEFAULT ''"],
    // 老师自己的性别（单子指定性别要求时用来判断）
    ['teachers', 'gender', short],
    // 消息中心：谁发的 / Agent / 合同 / 已读
    ['messages', 'sender_type', short],
    ['messages', 'agent_id', score],
    ['messages', 'kind', short],
    ['messages', 'contract_url', mysql ? 'VARCHAR(512) NOT NULL DEFAULT \'\'' : "TEXT NOT NULL DEFAULT ''"],
    ['messages', 'is_read', score],
    ['messages', 'external_id', nullText],
    // 消息中心：这条通知挂在哪条单子下面（0 = 不挂单子，比如助手发的合同 / 系统公告）。
    // 老师端「消息」页按这一列把同一张单子的通知归成一张卡片。
    ['messages', 'post_id', score],
    // 消息中心：这条通知是哪一条投递产生的（0 = 跟具体投递无关）。
    // 老师撤回投递时按这一列把这次投递已经写下的通知一并删掉（投递又撤回＝没发生）。
    ['messages', 'booking_id', score],
    // 会话：Agent 会话 + 发送方类型
    ['chats', 'agent_id', score],
    ['chats', 'sender_type', short]
  ];
  for (const [table, column, type] of additions) {
    try {
      await db.run('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + type);
    } catch (e) {
      // 已经有了：忽略
    }
  }
}

async function migrate(db) {
  /*
   * 先补老库缺的列，再建表 / 建索引。
   * 顺序不能反：像 idx_bookings_post 建在 post_id 上，老库里这列是后来才补的，
   * 先建索引会直接报"no such column"。新库这里 ALTER 会报"no such table"，忽略即可。
   */
  await ensureColumns(db);
  const list = db.driver === 'mysql' ? MYSQL_DDL : SQLITE_DDL;
  for (const sql of list) {
    await db.exec(sql);
  }
  await migrateStatuses(db);
}

/*
 * 订单状态搬到新流程（试课中 / 主订单进行中 / 已结束）：
 *   老库里的「已确认」「已预约」都是"课定下来了"，直接算主订单进行中（不倒退回去补试课）。
 * 幂等：改过一次之后再跑没有匹配行。
 */
async function migrateStatuses(db) {
  try {
    await db.run(
      'UPDATE bookings SET status = ? WHERE status IN (?, ?)',
      ['主订单进行中', '已确认', '已预约']
    );
  } catch (e) {
    // 老库还没有 bookings 表（首次建库时不会走到这里）或列不存在：忽略
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
