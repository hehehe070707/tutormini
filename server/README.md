# TutorMini 后端（唯一真实数据源）

用户、订单、发布、聊天、评价**全部存在这里**。小程序端不存业务数据，只存一枚登录令牌。
手机、模拟器、任何设备访问的都是这一份数据。

## 起步（开发）

**双击项目根目录的 `启动后端.cmd`** 就行（它会自己找 node，找不到会提示怎么装）。

或者在命令行里：

```powershell
cd server
node server.js        # 默认 http://127.0.0.1:3000，数据库文件 server/data/tutor.db
```

**零依赖**：只用 Node 自带的 `http` 和 `node:sqlite`，不用 `npm install`（需要 Node 22.5+，本机是 Node 24）。

启动成功会打印：

```
家教平台后端已启动：http://127.0.0.1:3000
数据库：sqlite（...\server\data\tutor.db）
真机调试用的地址（填到 utils/config.js 的 DEV_BASE）：
  http://192.168.x.x:3000/api
（保持这个窗口开着，关掉就等于后端停止）
```

跑测试：

```powershell
node server/test/api.test.js     # 后端接口：注册登录 / 下单接单 / 聊天 / 评价 / 令牌
node tools/simulate.js           # 小程序端数据层模拟跑一遍（在项目根目录执行）
```

## 小程序怎么连上来

| 场景 | 怎么做 |
| --- | --- |
| 开发者工具（模拟器） | 后端跑在本机就行，`utils/config.js` 里的开发地址是 `http://127.0.0.1:3000/api` |
| 真机预览 / 真机调试 | 把 `utils/config.js` 的 `DEV_BASE` 改成电脑的局域网 IP，手机和电脑连同一个 WiFi。IP 别自己猜：双击项目根目录的 `查看本机IP.cmd`，它会打印地址+探活；校园网挡得住就用 `穿透后端.cmd` |
| 上线 | 后端部署到云服务器，`utils/config.js` 里 `IS_DEV = false` 并填 `PROD_BASE`，还要在小程序后台把域名加进 **request 合法域名** |

开发阶段记得在微信开发者工具「详情 → 本地设置」勾上 **不校验合法域名**（`project.config.json` 里的 `urlCheck` 已经是 `false`）。

## 上线换成 MySQL

业务代码一行都不用改，只换环境变量：

```powershell
npm i mysql2                                  # 服务器上装驱动（本地开发不用装）
$env:DB_DRIVER="mysql"
$env:MYSQL_HOST="127.0.0.1"; $env:MYSQL_USER="tutor"; $env:MYSQL_PASSWORD="******"
$env:MYSQL_DATABASE="tutormini"
node server.js
```

首次启动会自动建库建表（`db/schema.js` 里 SQLite / MySQL 两套 DDL，字段一一对应）。

## 接微信自动登录（可选）

填上小程序密钥后，`wx.login` 的 code 会被换成 openid，下次打开免密码直接登录：

```powershell
$env:WX_APPID="wxaa4fb30710adfcc2"
$env:WX_SECRET="小程序密钥"
node server.js
```

没填时（本地开发）`/api/auth/wx-login` 会返回 `needBind: true`，小程序自动退回「姓名 + 密码」登录；
登录成功后依旧会把 openid 绑上，上线后同一台微信就能自动登录。

## 环境变量一览

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | 3000 | 监听端口 |
| `HOST` | 0.0.0.0 | 监听地址（真机调试要监听局域网，别改成 127.0.0.1） |
| `DB_DRIVER` | sqlite | `sqlite` / `mysql` |
| `SQLITE_FILE` | server/data/tutor.db | SQLite 文件位置 |
| `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` | — | MySQL 连接信息 |
| `WX_APPID` / `WX_SECRET` | 空 | 微信小程序密钥，留空则不走微信登录 |
| `TOKEN_DAYS` | 90 | 令牌有效期（天） |
| `SEED_DEMO` | 开 | 首次启动写入三位示例老师，设 `0` 关掉 |
| `AGENT_WEBHOOK_URL` | 空 | 外部 Agent 的事件回调地址；留空则事件只写 `agent_events`，等对方来拉 |
| `AGENT_PARSE_URL` | 空 | 外部 Agent 的"家长原话 → 结构化要求"解析接口（`POST { text }`）；留空则走本地兜底规则 |
| `AGENT_PARSE_TOKEN` | 空 | 调上面那个接口时带的 `X-Agent-Token`（外部 Agent 那边校验用） |
| `AGENT_PARSE_TIMEOUT_MS` | 5000 | 解析接口超时；超时算解析失败（固定字段全「不限」），不阻塞发单 |
| `AGENT_PARSE_LESSON_HOURS` | 2 | 家长按次 / 按节给钱、又没写"一次上几小时"时，按这个时长折算时薪 |

## 接口一览

返回格式统一 `{ code: 0|1, message, data }`；失败时 `message` 就是小程序端弹窗的文案。
登录后的接口都要带令牌：请求头 `X-Token: <token>`（也支持 `Authorization: Bearer <token>`）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查（小程序启动时探活） |
| POST | `/api/auth/register` | 注册（学生/老师，body 带可选 `code` 用于绑定微信） |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/wx-login` | wx.login 的 code 换 openid → 自动登录 |
| POST | `/api/auth/logout` | 退出（只作废当前这枚令牌） |
| GET | `/api/auth/me` | 用令牌换身份（启动时自动登录） |
| GET | `/api/me` | 「我的」页汇总：身份 + 资料 + 统计 + 科目 |
| GET | `/api/teachers` | 老师列表（`subject` / `keyword` / `lat` / `lng` / `km` / `all`） |
| GET | `/api/teachers/subjects` | 科目下拉 |
| GET | `/api/teachers/:id` | 老师详情（带距离） |
| PUT | `/api/teachers/me` | 保存老师资料 |
| GET/PUT | `/api/students/me` | 学生资料 |
| GET | `/api/bookings/mine` | 我的订单（按令牌身份分平台/老师），带课次账 + 收款退款记录 |
| POST | `/api/bookings/:id/accept` \| `/reject` | 平台确认 / 回绝老师的接单申请（accept 可带 `amount` / `contractUrl` 一起发合同） |
| POST | `/api/bookings/:id/cancel` | 取消预约：平台取消自己发的、老师取消自己接的；取消后单子回到「招募中」 |
| POST | `/api/bookings/:id/finish` | 结束订单（还有课次没确认时会挡） |
| POST | `/api/bookings/:id/contract` | 平台发合同 + 收款码（记合同金额和链接） |
| POST | `/api/payments/:id/paid` | 老师点「我已付款」 |
| POST | `/api/payments/:id/confirm` | 平台核对到账后确认收款（确认后老师才能提交试课） |
| POST | `/api/payments/:id/refund` | 平台确认退款（留空＝全额；上过一次课就填扣完该退的金额） |
| GET | `/api/posts/open`（别名 `/api/posts`） | 招募中的单。老师侧**双向筛选**：① 单子本身 `grade` / `subject` / `time` / `minPrice`（最低时薪）/ `km`（或 `radius`）；② 单子的要求 `gender` / `education` / `minYears` / `certificate` / `teachMode`（多选，逗号分隔；「不限」＝不筛）；③ 我自己的情况 `myGender` / `myEducation` / `myYears` / `myCertificate` / `myTeachMode`（多选）；再加 `onlyMatch=1` 的"我符不符合"。返回带 `matchLevel`（full/partial/none）、`matchScore`、`matchReasons`、`matchDetails`、`rawText` |
| GET | `/api/posts/recommended` | 老师端推荐：和选单同一份数据，按匹配度排序（完全符合 → `matchScore` 高的 → 距离近），默认只给 `matchLevel != none` |
| GET | `/api/posts/mine` | 我发布的单 |
| POST | `/api/posts` | 发布单（生成单号 `code`；可带 `grade` / `gender` / `requirements` / `rawText`；位置、说明、家长原话里的联系方式自动抹掉） |
| POST | `/api/posts/batch` | 批量发单 `{ posts: [...] }` → `{ ok, failed, batchId }`，逐条落库 |
| POST | `/api/posts/:id/take` \| `/close` | 投递简历（只有老师）、撤销发布（只有发单的平台账号） |
| POST | `/api/agent/parse` | 家长原话 → 结构化要求：`{ text }` → `{ gender, education, minYears, certificate, teachMode, raw_text, source }`；批量用 `{ texts: [...] }` → `{ list: [...] }`。解析失败不让发单失败（固定字段全「不限」+ 原话保留） |
| GET | `/api/agents/mine` | 我的官方助手会话（老师端消息页置顶，标官方） |
| GET | `/api/me/unread` | 未读总数（红点：官方助手会话 + 系统通知） |
| GET/POST | `/api/chats/agent/:agentId` | 老师 ↔ 官方助手会话（不受条数限制） |
| POST | `/api/chats/agent/:agentId/read` | 助手会话标已读 |
| GET | `/api/messages/mine` | 消息中心：系统通知 / 合同 / Agent 消息 |
| POST | `/api/messages/:id/read` | 通知标已读 |

### 外部 Agent 专用（请求头 `X-Agent-Token: <令牌>`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/agent/posts/batch` | 批量发单，`source` 自动标 `agent`，发单方是令牌绑定的平台账号 |
| POST | `/api/agent/message` | 给老师发消息 / 合同：`{ to_user_id, type: text\|contract\|system, content, contract_url }` |
| POST | `/api/agent/chat/reply` | 回复老师发来的聊天：`{ teacher_id, content }` |
| GET | `/api/agent/events?since=&limit=` | 拉取待处理事件（和 webhook 二选一） |

### 家长原话 → 结构化要求（`POST /api/agent/parse`）

中介从家长那里拿到的是自由文本，发单前把小段原话发给这个接口，拿回固定字段：

```jsonc
// 请求
{ "text": "要女老师，硕士以上，最好有经验，能线下，一次 400 元（一次两小时）" }
// 返回（source: agent=外部解析 / local=本地兜底 / none=没解析出来 / empty=没原话）
{ "gender": "女", "education": "硕士", "minYears": "不限",
  "certificate": "不限", "teachMode": "线下",
  "priceMin": 200, "priceMax": 200,
  "raw_text": "要女老师，硕士以上，最好有经验，能线下，一次 400 元（一次两小时）", "source": "local" }
```

固定字段与取值（缺省一律「不限」＝家长没提，不参与筛选）：

| 字段 | 取值 |
| --- | --- |
| `gender` | 不限 / 男 / 女 |
| `education` | 不限 / 本科 / 硕士 / 博士 |
| `minYears` | 不限 / 1 / 3 / 5 |
| `certificate` | 不限 / 教师资格证 / 普通话证书 / 四六级 / 雅思托福（老写法"英语四级""六级""CET-6""IELTS"会自动归一） |
| `teachMode` | 不限 / 线下 / 线上 |
| `priceMin` / `priceMax` | 不限 / 整数（**元/小时**）|

**价格一律折成"元/小时"**（家长给钱的方式不统一）：

| 家长原话 | 存下来的时薪 |
| --- | --- |
| `150 元/小时` / `每小时 150` / `150 一小时` | 150 |
| `100-150 元/小时` | 100-150 |
| `一次 400 元（一次两小时）` / `400 元/次（一次 2 小时）` | 200 |
| `300 元/节课`（没写时长） | 150（按 `AGENT_PARSE_LESSON_HOURS`，默认 2 小时） |
| `价格面议` / `一个月 3000` / 说了好几个价 | 不限（能算才算，算不了不瞎猜） |

解析交给外部 Agent：配 `AGENT_PARSE_URL`（可再加 `AGENT_PARSE_TOKEN`）后，后端把 `{ text }` POST 过去，
返回 `{ gender, ... }`、`{ requirements: {...} }`、`{ data: {...} }` 三种写法都认，字段一律过白名单（认不出的写「不限」）；
**没配就走 `server/domain/parse.js` 里的本地兜底规则**（只认明说的，"最好有经验"这类含糊说法不猜）。
超时（默认 5s，`AGENT_PARSE_TIMEOUT_MS`）或报错 = 解析失败 → 固定字段全「不限」、原话照原样保留，**不阻塞发单**。

### 事件钩子

关键节点写进 `agent_events`；配了 `AGENT_WEBHOOK_URL` 会在请求返回之后异步 POST 出去：
`booking_created`（老师投递）、`booking_confirmed`（平台确认接单）、`booking_rejected`（平台回绝）、
`contract_ready`（合同可以发了）。没配 webhook 时外部 Agent 用 `/api/agent/events` 增量拉。

### 给外部 Agent 发令牌

```powershell
node tools/agent-token.js 1            # 1 = 平台（学生）账号 id，也可以直接写账号姓名
node tools/agent-token.js --list       # 看已有令牌（只显示摘要前 8 位）
node tools/agent-token.js --revoke 3   # 吊销 3 号令牌
```

令牌原文只在创建时打印一次，库里存 SHA-256 摘要；外部 Agent 调接口时带 `X-Agent-Token`。

### 隐私约定

平台账号下的真实客户信息（姓名 / 电话 / 门牌号）**不下发给老师**：老师端只看到「平台 + 单号」；
单子的位置 / 说明在入库前会过一遍 `stripContacts`，手机号、微信号一律抹掉。

### 单子要求与老师匹配（老师选单页的"双重筛选"）

`posts.requirements` 存 JSON，就是上面那张表的固定字段（家长原话解析出来的结果，只存明确提了的；
另外兼容旧的 `school`（学校层次）和旧键名 `budgetMin` / `budgetMax`（当 `priceMin` / `priceMax` 用））。
`posts.raw_text` 存家长原话，**只展示不参与筛选和匹配**。旧数据没有要求 = 全「不限」= 全部 ✅。

`server/domain/match.js` 的 `matchTeacher(post, teacher, { distanceKm })` 返回 `{ level, score, reasons, details }`：

| 比对项 | 性质 | 不满足时 |
| --- | --- | --- |
| 可教科目、教龄（要求最低年限）、性别（单子指定）、学历（单子写层级） | 硬条件 | `level = none`（默认被隐藏） |
| 证书、学校层次、时薪 | 软条件 | `level = partial` |
| 授课方式（线上 / 线下） | 软条件 | 筛选面板里勾了"我能线上/线下"才判断；没勾只当提示、不打分 |
| 距离 | 软提示 | `level = partial`（不计进匹配度打分） |
| 老师对应字段没填 | 存疑 | `level = partial`（不算"不满足"，避免误杀） |

`score` 是匹配度打分（硬条件 2 分、软条件 1 分，距离不计分），"家长明确提了、老师又满足"的要求越多分越高。
排序：完全符合 → 部分符合 → 不符合 → 匹配度高的 → 距离由近到远 → 时间不冲突优先 →（用了筛选时）价格由高到低。

### 老师端筛选的规矩（双向 + 多选）

老师端筛选面板分三块，都是可选的：

| 块 | 参数 | 规则 |
| --- | --- | --- |
| 单子本身 | `grade` / `subject` / `time` / `minPrice` / `km` | 价格只有"最低时薪"这一个条件：单子的时薪下限 ≥ 填的值才显示；价格没写的（不限）不筛掉 |
| 单子的要求（多选） | `gender` / `education` / `certificate` / `teachMode` | 单子要求「不限」＝家长没提，一律留下；提了的必须在老师勾的选项里 |
| 我自己的情况（多选） | `myGender` / `myEducation` / `myCertificate` / `myTeachMode` | 勾了才拿它去卡单子：单子提的要求我都得满足。学历按"我的最高档"比（我硕士，要求本科的单也该看得见） |

教龄那两条（`minYears` / `myYears`）**页面上已经删掉**，接口参数还认（外部调用 / 老链接兼容），但小程序里不再提供入口。

例：老师勾 `gender=女`（单子的要求）→ 只筛出 `gender=女` 的单，`gender=不限` 的也展示；
老师勾 `myEducation=本科`（我自己的情况）→ 要硕士的单被藏起来，要本科 / 不限的留下。
一个都不勾＝这条不筛；`onlyMatch=1` 才是按「我的简历」自动算"我符不符合"。

**不符合的单默认也返回**（老师端开着"显示全部单"）：排序是 完全符合 → 部分符合 → 不符合 → 匹配度高的 → 距离近，
小程序在第一条"不符合"前面插一条分界线 + 提示，老师关掉列表里的那一段就是自己想要的。`onlyMatch=1` 才会把不符合的筛掉。

## 目录结构

```
server.js            入口：起 HTTP 服务、统一响应格式
config.js            端口 / 数据库 / 微信密钥（全走环境变量）
db/index.js          按配置选驱动 + 建表 + 示例数据
db/sqlite.js         开发驱动（node:sqlite，零依赖）
db/mysql.js          上线驱动（mysql2，同一套接口）
db/schema.js         SQLite / MySQL 两套建表语句 + 示例老师
domain/accounts.js   学生/老师账号、资料、会话令牌、openid 绑定
domain/bookings.js   预约/订单（撞课判断、价格快照、确认拒绝取消）
domain/reviews.js    评价与回复（只有下过单能评、只能评一条、只能回一次）
domain/posts.js      发布单（学生发单 / 老师接单，接单在事务里先抢单）
domain/chats.js      一对一聊天（会话按 学生id+老师id 唯一确定）
domain/nearby.js     附近筛选（Haversine 距离，半径过滤）
domain/notify.js     站内通知（对应 Qt 版 messages 表）
http/router.js       路由表 + 令牌鉴权
http/handlers.js     每个接口一个函数
auth/wx.js           wx.login code → openid（没配密钥时为开发降级）
test/api.test.js     后端集成测试
```

## 账号 / 令牌说明

- 学生、老师都是「姓名 + 密码」账号，**密码只存 SHA-256 摘要**，从不落明文。
- 登录成功后后端发一枚随机令牌，库里只存它的 SHA-256 摘要，有效期 90 天。
- 多设备可以同时在线，各自一枚令牌；退出只作废自己那一枚。
- 前端 `wx.storage` 里只有 `session_token` 一个 key，改它没用：每次都拿它向后端换身份。
