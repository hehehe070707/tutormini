const path = require('node:path');

const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',

  dbDriver: String(process.env.DB_DRIVER || 'sqlite').toLowerCase(),
  sqliteFile: process.env.SQLITE_FILE || path.join(__dirname, 'data', 'tutor.db'),

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

  tokenDays: Number(process.env.TOKEN_DAYS || 90),
  seedDemo: process.env.SEED_DEMO !== '0',

  agentWebhookUrl: process.env.AGENT_WEBHOOK_URL || '',

  agentParseUrl: process.env.AGENT_PARSE_URL || '',
  agentParseToken: process.env.AGENT_PARSE_TOKEN || '',
  agentParseTimeoutMs: Number(process.env.AGENT_PARSE_TIMEOUT_MS || 5000),

  lessonHours: Number(process.env.AGENT_PARSE_LESSON_HOURS || 2),
  maxBodyBytes: 256 * 1024
};

module.exports = config;
