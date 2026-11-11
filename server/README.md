# TutorMini 后端

Node.js 后端，开发环境使用 SQLite，也支持 MySQL。

## 启动

```powershell
cd server
node server.js
```

默认监听 `0.0.0.0:3000`。需要 Node.js 22.5 或更高版本。

Windows 也可以直接双击项目根目录的 `启动后端.cmd`。

## 数据库

默认数据库文件是 `server/data/tutor.db`，首次启动自动建表。

使用 MySQL 时先安装驱动：

```powershell
npm install mysql2
```

然后设置环境变量：

```powershell
$env:DB_DRIVER="mysql"
$env:MYSQL_HOST="127.0.0.1"
$env:MYSQL_PORT="3306"
$env:MYSQL_USER="tutor"
$env:MYSQL_PASSWORD="你的密码"
$env:MYSQL_DATABASE="tutormini"
node server.js
```

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DB_DRIVER` | `sqlite` | `sqlite` 或 `mysql` |
| `SQLITE_FILE` | `server/data/tutor.db` | SQLite 文件路径 |
| `LOG_FILE` | 数据库目录下的 `backend.log` | 日志路径 |
| `TOKEN_DAYS` | `90` | 登录令牌有效天数 |
| `SEED_DEMO` | 开启 | 设为 `0` 可关闭示例老师 |
| `WX_APPID` | 空 | 微信小程序 AppID |
| `WX_SECRET` | 空 | 微信小程序 AppSecret |
| `AGENT_PARSE_URL` | 空 | 家长原话解析接口 |
| `AGENT_PARSE_TOKEN` | 空 | 解析接口令牌 |
| `AGENT_WEBHOOK_URL` | 空 | Agent 事件回调地址 |
| `AGENT_PARSE_TIMEOUT_MS` | `5000` | 解析接口超时 |
| `AGENT_PARSE_LESSON_HOURS` | `2` | 按次价格折算时薪时使用的课时长度 |

MySQL 相关变量为 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`、`MYSQL_POOL`。

## 测试

```powershell
node test/api.test.js
```

测试使用临时数据库，不会修改开发数据。

## 接口

接口统一返回：

```json
{ "code": 0, "message": "", "data": {} }
```

登录后请求头添加 `X-Token: <token>`。

| 模块 | 路径 |
| --- | --- |
| 健康检查 | `/api/health` |
| 注册登录 | `/api/auth/*` |
| 老师与学生资料 | `/api/teachers/*`、`/api/students/me` |
| 发布单 | `/api/posts/*` |
| 订单与课次 | `/api/bookings/*`、`/api/lessons/*` |
| 合同与收款 | `/api/payments/*` |
| 消息 | `/api/messages/*` |
| 官方助手 | `/api/agents/*`、`/api/chats/agent/*` |
| 家长原话解析 | `/api/agent/parse` |

外部 Agent 使用 `X-Agent-Token` 调用 `/api/agent/*`。

创建令牌：

```powershell
node tools/agent-token.js <学生账号 id 或姓名> [备注]
node tools/agent-token.js --list
node tools/agent-token.js --revoke <令牌 id>
```

令牌原文只在创建时显示一次，数据库只保存摘要。

## 数据安全

- 密码保存 SHA-256 摘要。
- 登录令牌只保存摘要，并设置有效期。
- 数据库、日志、`.env` 和微信密钥不要提交到 Git。
