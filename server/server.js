const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config.js');
const { openDatabase } = require('./db/index.js');
const { dispatch } = require('./http/router.js');
const { ApiError } = require('./lib/errors.js');
const agent = require('./domain/agent.js');

let agentFlushing = false;

function stamp() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function logFileFor(cfg, db) {
  if (cfg.logFile) return cfg.logFile;
  const location = (db && db.location) ? db.location : cfg.sqliteFile;
  const dir = location ? path.dirname(location) : path.join(__dirname, 'data');
  return path.join(dir, 'backend.log');
}

function createLogger(file) {
  let target = file || '';

  function write(text) {
    if (target === '') return;
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.appendFileSync(target, text);
    } catch (e) {
      target = '';
    }
  }
  write('\n===== ' + stamp() + ' 后端启动（PID ' + process.pid + '） =====\n');
  return {
    file: file || '(未启用文件日志)',
    line(text) {
      console.log(text);
      write('[' + stamp() + '] ' + text + '\n');
    },
    error(text) {
      console.error(text);
      write('[' + stamp() + '] ' + text + '\n');
    }
  };
}

function send(res, status, payload) {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Token, X-Agent-Token',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS'
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > config.maxBodyBytes) {
        reject(new ApiError('请求内容太大。', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw === '') return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new ApiError('请求格式不对（不是合法 JSON）。', 400));
      }
    });
    req.on('error', reject);
  });
}

async function createServer(dbOverride) {
  const db = dbOverride || await openDatabase(config);
  const log = createLogger(logFileFor(config, db));

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    if (req.method === 'OPTIONS') {
      send(res, 204, {});
      return;
    }

    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    const query = {};
    url.searchParams.forEach((value, key) => { query[key] = value; });

    const ctx = {
      db,
      config,
      req,
      res,
      method: req.method,
      pathname: url.pathname,
      query,
      body: {},
      params: {},
      auth: null,
      token: ''
    };

    try {
      if (req.method === 'POST' || req.method === 'PUT') {
        ctx.body = await readBody(req);
      }
      const data = await dispatch(ctx);
      send(res, 200, { code: 0, message: '', data });

      if (config.agentWebhookUrl && !agentFlushing) {
        agentFlushing = true;
        Promise.resolve()
          .then(() => agent.flush(db, config))
          .catch(() => {})
          .then(() => { agentFlushing = false; });
      }
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 500;
      const message = e instanceof ApiError ? e.message : ('服务器出错了：' + (e && e.message ? e.message : e));
      if (!(e instanceof ApiError)) {

        log.error('[500] ' + ctx.method + ' ' + ctx.pathname + ' → ' + (e && e.stack ? e.stack : e));
      }
      send(res, status, { code: 1, message, data: null });
    } finally {
      const ms = Date.now() - started;
      log.line(ctx.method + ' ' + ctx.pathname + ' ' + res.statusCode + ' ' + ms + 'ms');
    }
  });

  server.on('close', () => {
    if (!dbOverride) db.close();
  });

  return { server, db, log };
}

if (require.main === module) {

  const [major, minor] = String(process.versions.node).split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 5)) {
    console.error('启动失败：需要 Node.js 22.5 或更高版本（当前 ' + process.version + '）。');
    console.error('去 https://nodejs.org/ 装一个 LTS 版即可。');
    process.exit(1);
  }

  createServer().then(({ server, db, log }) => {

    process.on('uncaughtException', (e) => {
      log.error('后端崩了（未捕获的异常）：' + (e && e.stack ? e.stack : e));
      process.exit(1);
    });
    process.on('unhandledRejection', (e) => {
      log.error('后端有未处理的 Promise 失败：' + (e && e.stack ? e.stack : e));
    });

    server.on('error', (e) => {
      if (e && e.code === 'EADDRINUSE') {
        log.error('端口 ' + config.port + ' 已经被占用 —— 很可能后端已经在运行了，不用重复启动。');
      } else {
        log.error('服务出错：' + (e && e.message ? e.message : e));
      }
      process.exit(1);
    });

    server.listen(config.port, config.host, () => {
      log.line('家教平台后端已启动：http://127.0.0.1:' + config.port);
      log.line('数据库：' + db.driver + '（' + db.location + '）');
      log.line('日志文件：' + log.file);

      const lan = [];
      const interfaces = os.networkInterfaces();
      Object.keys(interfaces).forEach((name) => {
        (interfaces[name] || []).forEach((info) => {
          if (info && info.family === 'IPv4' && !info.internal) {
            lan.push('http://' + info.address + ':' + config.port + '/api');
          }
        });
      });
      if (lan.length > 0) {
        log.line('真机调试用的地址（填到 utils/config.js 的 DEV_BASE）：');
        lan.forEach((url) => log.line('  ' + url));
      }
      if (!config.wechat.appid || !config.wechat.secret) {
        log.line('提示：没配 WX_APPID / WX_SECRET，自动登录走不了微信，请用「姓名 + 密码」登录（本地开发正常）。');
      }
      log.line('（保持这个窗口开着，关掉就等于后端停止）');
    });
  }).catch((e) => {
    console.error('启动失败：', e && e.message ? e.message : e);
    process.exit(1);
  });
}

module.exports = { createServer };
