# TutorMini 开发说明

## 项目

TutorMini 是原生微信小程序加 Node.js 后端的家教供需平台。

家长发布需求，老师投递简历，家长确认后进入试课和正式课流程。发单支持从家长原话中提取结构化要求。

## 运行

```powershell
cd server
node server.js
```

需要 Node.js 22.5 或更高版本。Windows 也可以双击项目根目录的 `启动后端.cmd`。

开发时在微信开发者工具中导入项目根目录，填写自己的 AppID，并关闭合法域名校验。

## 测试

```powershell
node server/test/api.test.js
node tools/simulate.js
```

页面脚本修改后至少执行：

```powershell
node --check pages/页面目录/页面.js
```

检查页面 `.js`、`.json`、`.wxml`、`.wxss` 齐全，跳转路径存在，`wx:for` 使用 `wx:key`。

## 目录

- `pages/`：小程序页面
- `utils/`：网络请求、登录态、定位和业务接口
- `custom-tab-bar/`：底部导航
- `server/`：Node.js 后端、数据库和接口测试
- `tools/`：局域网地址、隧道、Agent 令牌和模拟测试
- `legacy/`：旧本地缓存实现，仅作参考

## 开发约定

- 业务数据以后端为准，小程序本地只保存 `session_token`。
- 密码只保存 SHA-256 摘要。
- 接口失败原因读取 `store.lastError`，返回 id 的接口失败返回 `-1`。
- 页面数据在 `onShow` 刷新，事件订阅在 `onShow` 注册、`onHide` 注销。
- 切换底部 Tab 使用 `wx.switchTab`。
- 保持白色背景和青绿色点缀的现有视觉风格。
- 注释只写无法从代码直接看出的约束，不复述代码，不写教程。
- 不提交数据库、日志、`.env`、`project.private.config.json` 或密钥。
- `tools/*.ps1` 必须保存为 UTF-8 BOM，根目录 `.cmd` 必须保持纯 ASCII。
- `utils/config.js` 中的 `DEV_BASES` 和 `TUNNEL_BASE` 会被脚本改写，不要改变变量名和值格式。
- 不删除文件，不修改用户已有的无关改动。

## 提交

重要改动同步更新 `changelog/CHANGELOG.md`。

完成检查后使用 `git add` 和 `git commit` 保存。未得到明确要求时不要执行 `git push`。
