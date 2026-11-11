# TutorMini · 家教平台（微信小程序版）

一个家教供需撮合平台。家长发布需求，老师投递简历，家长确认后成交。

发单时可以直接粘贴家长原话，由 Agent 整理成结构化需求。

客户端使用原生小程序，后端使用 Node.js，开发环境为 SQLite，也支持 MySQL。业务数据统一保存在后端，手机和模拟器共享同一份数据。

## 功能

- 家长发布、批量发布求教需求
- Agent 将口语化需求整理为科目、年级、时间、价格、老师要求等标准字段
- 老师浏览订单、筛选匹配、投递简历
- 家长查看简历并确认接单
- 试课、正式课、课次确认和收款记录
- 站内消息与官方助手会话
- 学生、老师身份隔离和登录令牌鉴权

## 快速开始

### 1. 启动后端

需要 Node.js 22.5 或更高版本。

```powershell
cd server
node server.js
```

服务默认运行在 `http://127.0.0.1:3000`。（暂时）

Windows 可以直接双击 `启动后端.cmd`。需要开机自动启动时，双击一次 `安装开机自启.cmd`。

### 2. 打开小程序

1. 用微信开发者工具导入项目根目录。
2. 填写自己的小程序 AppID。
3. 在「详情 → 本地设置」中勾选「不校验合法域名」。
4. 编译运行。

### 3. 真机调试

手机和电脑连接同一 WiFi，双击 `查看本机IP.cmd`，按提示确认 `utils/config.js` 中的局域网地址。

如果校园网或公司网络隔离设备，双击 `穿透后端.cmd` 启动 Cloudflare 临时隧道。脚本会自动写入 `TUNNEL_BASE`。

提示「连不上后端」时，先确认后端已经启动，再点击小程序里的「重试」。

## 数据库

开发环境默认使用 SQLite，数据文件位于 `server/data/`。

切换 MySQL 时设置 `DB_DRIVER=mysql`，再配置 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`。首次启动会自动建库建表。

微信自动登录可选配置：

```powershell
$env:WX_APPID="你的 AppID"
$env:WX_SECRET="你的 AppSecret"
```

完整配置见 [server/README.md](server/README.md)。

## 测试

```powershell
node server/test/api.test.js
node tools/simulate.js
```

第一个命令测试后端接口，第二个命令模拟两台设备执行发单、投递、确认、课次、收款和消息流程。

## 目录

```text
pages/             小程序页面
utils/             网络、登录、定位和页面数据接口
custom-tab-bar/    自定义底部导航
server/            Node.js 后端与数据库
tools/             地址同步、隧道、Agent 令牌和模拟测试
legacy/            旧本地缓存实现，仅作参考
```

## 常用脚本

| 文件 | 作用 |
| --- | --- |
| `启动后端.cmd` | 启动后端、同步局域网地址并启动临时隧道 |
| `停止后端.cmd` | 停止后端和隧道 |
| `安装开机自启.cmd` | 添加开机启动项 |
| `取消开机自启.cmd` | 移除开机启动项 |
| `查看本机IP.cmd` | 查看局域网地址并检查后端 |
| `穿透后端.cmd` | 启动 Cloudflare 临时隧道 |

