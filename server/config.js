/*
 * 后端配置：开发用 SQLite（本机文件），上线换成 MySQL 只改环境变量，业务代码不动。
 * 对应小程序端原来的本地缓存库 tutor_db_v1 —— 现在这里就是「唯一真实数据源」的所在。
 *
 * 常用环境变量：
 *   PORT=3000                 监听端口
 *   DB_DRIVER=sqlite|mysql    数据库类型（默认 sqlite）
 *   SQLITE_FILE=./data/tutor.db
 *   LOG_FILE=./data/backend.log  后端日志文件（留空 = 数据库旁边的 backend.log）
 *   MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE
 *   WX_APPID / WX_SECRET      微信小程序密钥（留空则本地开发不接微信，走账号密码登录）
 *   SEED_DEMO=0               首次启动不写入示例老师
 *   AGENT_PARSE_URL           外部 Agent 的"家长原话 → 结构化要求"解析接口（留空走本地兜底规则）
 *   AGENT_PARSE_TOKEN         调上面那个接口时带的 X-Agent-Token（外部 Agent 那边校验用）
 *   AGENT_PARSE_TIMEOUT_MS    解析接口超时（默认 5000，超了当解析失败、不阻塞发单）
 *   AGENT_PARSE_LESSON_HOURS  家长按次给价、又没说一次上几小时时，按几个小时折算时薪（默认 2）
 */

const path = require('node:path');

const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',

  // 开发：SQLite 单文件；上线：MySQL
  dbDriver: String(process.env.DB_DRIVER || 'sqlite').toLowerCase(),
  sqliteFile: process.env.SQLITE_FILE || path.join(__dirname, 'data', 'tutor.db'),
  // 后端日志（请求行 + 500 堆栈 + 启动 / 崩溃）：留空就写在数据库旁边，见 server.js 的 logFileFor
  logFile: process.env.LOG_FILE || '',
  mysql: {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'tutormini',
    connectionLimit: Number(process.env.MYSQL_POOL || 10)
  },

  wechat: {
    appid: process.env.WX_APPID || '',
    secret: process.env.WX_SECRET || ''
  },

  tokenDays: Number(process.env.TOKEN_DAYS || 90),   // 令牌有效期（天），和原来一致
  seedDemo: process.env.SEED_DEMO !== '0',           // 首次启动写入示例老师（对应原 seedIfEmpty）
  // 外部 Agent 的事件 webhook：留空就只把事件写进 agent_events，等外部 Agent 自己来拉
  agentWebhookUrl: process.env.AGENT_WEBHOOK_URL || '',
  /*
   * 外部 Agent 的解析接口：中介粘家长原话 → POST { text } → 拿回结构化要求。
   * 留空 = 本地开发模式，用 domain/parse.js 里的保守关键词规则兜底。
   */
  agentParseUrl: process.env.AGENT_PARSE_URL || '',
  agentParseToken: process.env.AGENT_PARSE_TOKEN || '',
  agentParseTimeoutMs: Number(process.env.AGENT_PARSE_TIMEOUT_MS || 5000),
  // 家长按次 / 按节给钱、又没写一次上几小时的，按这个时长折算时薪（默认 2 小时）
  lessonHours: Number(process.env.AGENT_PARSE_LESSON_HOURS || 2),
  maxBodyBytes: 256 * 1024
};

module.exports = config;
