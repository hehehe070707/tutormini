# 改动日志
## 2026-10 定位调整（平台化，务必先读这一段）

学生端实际是**平台方（原“中介”）**在用：批量供单、确认接单、管理履约；登录身份仍然叫「学生」，界面上**不要出现“中介”两个字**，也**不能把客户（原“家长”）的联系方式下发给老师**。老师端仍是主要服务对象。

- **联系不上客户**：发单方在老师端统一显示「平台 + 单号（`posts.code`）」，客户姓名 / 电话 / 门牌号都不下发；单子的位置、说明入库前过 `server/lib/util.js` 的 `stripContacts`，手机号、微信号一律抹掉。老师的订单里 `studentName` 也是「平台」。
- **已经删掉的功能（别再加回来）**：学生写评价 / 老师回复评价（`reviews` 表和 `server/domain/reviews.js` 已删）、学生端「找老师」tab 与 `pages/teacherList`、学生直接下单给老师（`POST /api/bookings` / `store.createBooking`）、`lessons.pay`（原来的“学生付给老师”方向是反的）。老师的真人聊天只保留「老师 ↔ 平台账号」这一条兜底通道，正常走「老师 ↔ 官方助手」。
- **批量发单**：`POST /api/posts/batch`（整批一个事务、逐条 try/catch，返回 `{ ok, failed, batchId }`），页面在 `pages/postBatch/postBatch`（支持手动加行 + 粘贴 JSON/CSV）；`posts` 新增 `code` / `source`（manual|agent）/ `external_id`（唯一，幂等）/ `batch_id`，状态还支持 `pending_review`（先落库不上架）。
- **收款 / 退款（方向：老师 → 平台）**：平台确认接单时发合同和收款码（`payments` 表，`POST /api/bookings/:id/contract`）→ 老师点「我已付款」→ 平台「确认收款」→ 才能提交试课（`payments.assertTrialUnlocked`）→ 没上成平台确认全额退款，上过一次课按合同扣（`POST /api/payments/:id/refund`）。金额一律是整数元。
- **外部 Agent 接入（不实现 Agent 本体）**：`agents` / `agent_tokens` / `agent_events` 三张表；接口带 `X-Agent-Token`（路由 `auth: 'agent'`，见 `server/domain/agent.js`）；事件钩子 `booking_created` / `booking_confirmed` / `booking_rejected` / `contract_ready` 先写 `agent_events`，配了 `AGENT_WEBHOOK_URL` 再在响应后异步 POST（`server/server.js` 里 flush）。令牌用 `node tools/agent-token.js <平台账号 id>` 签发，库里只存摘要。消息中心 = `messages`（系统通知 / 合同）+ `chats`（老师 ↔ 官方助手，`agent_id > 0`）。
- **老师端推荐**：`GET /api/posts/recommended`（`server/domain/posts.js` 的 `recommended`），按科目匹配 → 距离 → 时间不冲突 → 价格接近打分，返回 `recommendReason`；接单页三个切换「推荐给你 / 全部单 / 附近单」。
- **文案约定**：原来的“家长”字样已全局改成“平台”；新的用户可见文案里不要出现“中介”“家长”。

## 2026-10-07 追加（老师选单页 + 单子要求匹配）

- **真人聊天整条删除**：`server/domain/chats.js` 已删，`/api/chats/peers`、`/api/chats/with/:peerId`、`/api/chats/unread` 全部下线（旧的“轮流一条”限额规则随之作废，别再照旧文档实现）。老师侧只剩「老师 ↔ 官方助手」这条通道：`GET/POST /api/chats/agent/:agentId`，未读走 `GET /api/me/unread`，消息页只有「官方助手 + 通知与合同」两块。`chats` 表还在用，但只服务 Agent 会话（`agent_id > 0`）。
- **老师选单页只有一个列表**：没有“推荐 / 附近”这种 tab（别再拆 tab）。筛选分两层——
  第一层筛单子本身：年级 / 科目 / 性别要求 / 上课时间 / 时薪区间 / 距离范围（默认 30 公里）；
  第二层筛“我符不符合”：`onlyMatch`（默认开＝只看能投的；关掉就是“显示全部单”）。
  排序在服务端 `postsForTaking`：完全符合 → 部分符合 → 不符合 → 距离近 → 时间不冲突 →（有筛选时）价格高。
- **单子要求 `posts.requirements`（JSON 文本）**：现在是**固定字段**（家长原话解析出来的）——
  `gender` 不限/男/女、`education` 不限/本科/硕士/博士、`minYears` 不限/1/3/5、
  `certificate` 不限/教师资格证/普通话证书、`teachMode` 不限/线下/线上、`priceMin` / `priceMax` 不限/整数（**元/小时**），
  **缺省一律「不限」＝家长没提、不参与筛选和匹配**；另外兼容旧数据的 `school` 和旧键名 `budgetMin` / `budgetMax`（当 priceMin/priceMax 用）。
  **价格一律折成时薪**：按次 / 按节给钱的能算就算（写了"一次几小时"按实际时长除，没写按 `AGENT_PARSE_LESSON_HOURS` 默认 2 小时），
  面议 / 一个月多少钱 / 说了好几个价的一律「不限」——能算才算，算不了不瞎猜。家长原话存在 `posts.raw_text`，
  只展示不参与计算（入库前过 `stripContacts`）。
  发单页、批量发单页、Agent 批量发单都能带；旧数据没有这个字段＝全「不限」＝全 ✅。解析统一走 `server/lib/util.js` 的 `parseRequirements` / `stringifyRequirements`。
- **匹配规则 `server/domain/match.js`**：`matchTeacher(post, teacher, { distanceKm })` → `{ level, score, reasons, details }`。
  硬条件（不满足＝none、老师端默认隐藏）：可教科目、最低教龄、指定性别、学历层级；
  软条件（不满足＝partial）：证书、学校层次、预算、距离；老师字段没填算“存疑”（partial），不算不满足。
  授课方式（线上线下）只当提示：老师资料里没有这个字段，判断不了，不参与档位和打分。
  学校要求里带“优先”二字＝加分项，不挡投递。
- **老师性别**：`teachers.gender`（我页里选，男/女/不限）。单子指定性别时靠它判断，没填的算存疑。
- **匹配相关的接口**：`GET /api/posts/open`（别名 `GET /api/posts`）支持
  ① 单子本身 `grade` / `subject` / `time` / `minPrice`（最低时薪，**价格只留这一个条件，不要再加"最高时薪"**）/ `km`（或 `radius`）；
  ② 单子的要求（**多选**，逗号或数组）`gender` / `education` / `minYears` / `certificate` / `teachMode`；
  ③ 我自己的情况（**多选**）`myGender` / `myEducation` / `myYears` / `myCertificate` / `myTeachMode`；
  ④ `onlyMatch`（按简历算"我符不符合"）。返回每条单带 `matchLevel` / `matchScore` / `matchReasons` / `matchDetails` / `rawText`。
  `GET /api/posts/recommended` 只给能投的、按匹配度排序（没有单独的 tab，接口留着给外部用）。
- **接单撞时间只提醒、不拦**：老师投递简历时如果这个时段和自己已有的课（待确认 / 试课中 / 主订单进行中）撞了，不算错 —— `postsForTaking` 会把这条单标上 `timeConflict`（列表里显示「时间冲突」），`POST /api/posts/:id/take` 第一次返回 `{ conflict: true, timeText }` **不落库**，前端弹一条提醒，老师确认后带 `force: true` 再调一次才真正投递（一天可以排好几节课）。别改回"直接报错"。
- **不要加额外的防乱取消机制**：后面会加支付功能，规则是"上课前 3 天内取消扣押金"，配合上面的 2 条限制就够，别再叠别的限制。
- **首页只放进行中的**：`pages/post` 上学生只看到「招募中 / 待你确认」的单、老师只看到「可接的单 + 待确认/已确认的课」；已成交、已撤销、已取消的历史单都收在 `pages/profile`（学生「我的发单历史」、老师「我接单的历史」）。
- **取消的两层（别搞混）**：没被接单之前取消的是**订单** —— 发单的学生在「我发布的」里撤销，单子作废；已经被接了取消的是**预约** —— 老师在自己「我接到的课」里、学生在「我的课程」里都能取消，取消后课变已取消，同时那条单子回到「招募中」（`server/domain/bookings.js` 里取消时调 `posts.reopenForBooking`），别的老师还能接。

## 2026-10-07 追加（家长原话 → 外部 Agent 解析成结构化要求）

- **中介发单前用原话**：家长给的是自由文本（"要女老师，硕士以上，最好有经验，能线下"），发单页 / 批量发单页把
  这段原话发 `POST /api/agent/parse`，拿回固定 5 字段直接保存发布，**中介不需要确认**。
- **解析交给外部 Agent**：配 `AGENT_PARSE_URL`（可选 `AGENT_PARSE_TOKEN`）后后端把 `{ text }` POST 过去；
  没配就走 `server/domain/parse.js` 的本地兜底规则（只认明说的，"最好有经验"这类含糊说法不猜）。
  超时（`AGENT_PARSE_TIMEOUT_MS`，默认 5s）/ 报错 = 解析失败 → 固定字段全「不限」+ 原话照原样保留，**不阻塞发单**。
  接口返回 `{ gender, education, minYears, certificate, teachMode, priceMin, priceMax, raw_text, source }`；
  批量传 `{ texts: [...] }` 返回 `{ list }`。价格见上面那条"一律折成时薪"。
- **原话落库**：`posts.raw_text`，只展示不参与筛选和匹配；入库前必须过 `stripContacts`（原话里常带手机号 / 微信号）。
- **老师端筛选是双向的，而且都能多选**（页面上就是两组勾选框，别改回单选 picker）：
  ① 「单子的要求」`gender` / `education` / `certificate` / `teachMode` —— 单子要求「不限」一律展示，
     提了的必须在勾选的选项里；② 「我自己的情况」`myGender` / `myEducation` / `myYears` / `myCertificate` / `myTeachMode`
     —— 勾了才拿它去卡单子（单子提的要求我都得满足），学历 / 教龄按"我的最高档"比。
  一个都不勾＝这条不筛；例：勾"要女老师"只筛出 `gender=女` 和 `gender=不限` 的单，勾"我：本科"就把要硕士的单藏起来。
  价格只有「最低时薪」一个条件（单子的时薪下限 ≥ 填的值才显示），**不要再加"最高时薪"输入框**。
- **教龄那两条筛选已经删掉**：老师端面板上不再有「最低教龄要求」和「我的教龄」两组勾选框（老板明确要去掉）。
  接口的 `minYears` / `myYears` 参数还留着（外部调用 / 老链接兼容），别再往页面上加回来。
- **证书固定五档**：`教师资格证` / `普通话证书` / `四六级` / `雅思托福`。老写法（"英语四级""六级""CET-6""IELTS"）在
  `util.certificateLevel` 里归一到这五档；老师简历里写"英语六级"也算有「四六级」（`match.js` 的 `CERT_KEYS`）。
- **不符合要求的单也要显示**：老师端默认 `onlyMatch=false`（显示全部单），不符合的排在最后，页面上在第一条不符合的前面
  插一条分界线 + 一句提示（`.group-divider`，`firstNonMatch` / `nonMatchTip`）。别改回"直接隐藏"，
  开关留着：老师自己想"只看符合的"再打开。
- **推荐排序**：完全符合 → 部分符合 → 不符合 → `matchScore` 高的（硬条件 2 分、软条件 1 分，距离不计分）→ 距离近。

## 2026-10-08 10:56

- 改动文件夹：`changelog/`（新建）、`D:\LZM\TutorMini`（根目录）
- 改动文件：新建 `changelog/CHANGELOG.md`；追加 `AGENTS.md`
- 改了什么：新建 `changelog/` 文件夹和 `changelog/CHANGELOG.md`，写入标题 `# 改动日志` 并落下第一条记录；同时在 `AGENTS.md` 末尾新增「## 改动日志（changelog）」一节，把「每次改完代码先在 `changelog/CHANGELOG.md` 末尾追加一条记录」写成长期规则（每条 250~500 字，必须写清楚改动文件夹名称，只追加不覆盖旧内容）。
- 为什么改：之前只有要求文本、磁盘上没有真正落地文件，用户在工程里找不到 `changelog` 目录。这次把「要求」和「内容」分开：要求放 `AGENTS.md`，内容放 `changelog/CHANGELOG.md`，避免下次又被当成文件不存在。
- 交互逻辑变化：改代码前流程不变；改代码后多一步「先追加日志 → 再结束任务」。用户下次打开工程，能在根目录直接看到 `changelog/CHANGELOG.md`，每次改动的文件夹、文件、原因、以及用户操作前后的差异都按时间往下排，方便回看；`AGENTS.md` 里只留规则，不再混改动内容。

## 2026-10-08 11:24

- 改动文件夹：`D:\LZM\TutorMini`（根目录，全站样式）；`changelog/`
- 改动文件：`app.wxss`（只改 `page` 一条规则，新增 4 行背景属性）；`changelog/CHANGELOG.md`（追加本条）
- 改了什么：给全局 `page` 加了一层左上角淡绿渐变点缀 —— `background-image: radial-gradient(100% 100% at 0% 0%, #E7F8F5 0%, rgba(231,248,245,0.55) 45%, rgba(231,248,245,0) 100%)`，配 `background-repeat: no-repeat`、`background-position: left top`、`background-size: 50vw 25vh`。颜色直接复用现有浅底色 `#E7F8F5`（只调透明度），没有引入新色值，也没有改任何页面 `wxss`、卡片、按钮、底部导航和 `app.json` 导航栏（仍是白底黑字）。
- 为什么改：全站改白底之后，页面右上到左下都是纯白，左上角显得空；按用户要求补一点绿，用「原来当底的浅绿」做渐隐，保持简约不抢内容。范围按用户给的限制卡死：横向最多半个屏宽、纵向最多四分之一屏高，所以只在左上角一小片，不会铺满首屏。
- 交互逻辑变化：用户点哪个页面、做什么操作都不变，没有新增可点击元素，也不影响滚动、切换 Tab 和弹窗。差别只在视觉：所有页面（含登录页、老师详情页、批量发单页等）从导航栏往下，左上角会出现一抹从 `#E7F8F5` 向右下渐变到透明的淡绿柔光；页面往下滚，这抹绿随内容一起滚走，长列表往下看仍是纯白底，卡片和信息流位置不动。

## 2026-10-08 12:02

- 改动文件夹：`server/domain/`（`posts.js` / `notify.js` / `agent.js` / `bookings.js` / `lessons.js` / `payments.js`）、`server/db/`（`schema.js`）、`server/http/`（`router.js` / `handlers.js`）、`server/test/`、`pages/message/`、`pages/postThread/`（新建）、`utils/`（`store.js`）、`custom-tab-bar/`、`pages/chat/`、`changelog/`
- 改动文件：`server/domain/posts.js`、`server/domain/notify.js`、`server/domain/agent.js`、`server/domain/bookings.js`、`server/domain/lessons.js`、`server/domain/payments.js`、`server/db/schema.js`、`server/http/router.js`、`server/http/handlers.js`、`server/test/api.test.js`、`pages/message/message.js|.wxml|.wxss`、`pages/postThread/postThread.js|.wxml|.wxss|.json`（新建）、`pages/chat/chat.js`、`utils/store.js`、`custom-tab-bar/index.js`、`app.json`、`changelog/CHANGELOG.md`
- 改了什么：① 单号从「年月-自增 id」（`2610-013`）改成「当日日期 + 当天第几个单」，比如今天第一个是 `20261008-1`，发单 / 批量发单 / Agent 发单共用一个函数；② `messages` 表加 `post_id`，`posts.js` / `bookings.js` / `lessons.js` / `payments.js` 里 39 处通知全部挂上对应的单子（老库启动时自动补列）；③ 新增老师端「我的单子」：`GET /api/messages/boxes`、`GET/POST /api/messages/boxes/:postId`，消息页把同一张单子的通知归成一张卡片，标题就是单号，卡片上带状态、未读数和最近一条；新建 `pages/postThread` 点卡片看这条单子从头到尾的消息；④ 红点：`utils/store.js` 去掉「读完还要等 3 秒缓存」的老逻辑，读完一条本地先减、广播 `unreadChanged`，`custom-tab-bar` 自己订阅事件当场重画。
- 为什么改：老师端消息页原来每来一条通知就多一行，一个单子从头到尾能刷出十几行，看不出这条单子走到哪一步；红点则要切到别的页面才更新，用户以为没生效。现在一条单子一张卡片，单号就是家长/平台对外的单号，红点点开就减。
- 交互逻辑变化：老师投递简历后，消息页多出一块「我的单子」，每张卡片写单号（如 `20261008-1`）+ 科目 + 状态（待平台确认 / 试课中 / 主订单进行中 / 已结束…）+ 未读数和最近一条内容，点它进「单子状态」页看这条单子的全部通知（合同类消息还能点一下复制链接）；同一张单子的通知不再在「通知与合同」里重复铺开（平台端没有卡片，照旧平铺）。红点方面：以前点开未读要切到别的 tab 才减少，现在点开通知 / 单子卡片 / 官方助手会话的瞬间数字就减，进卡片还会把这条单子整条标已读。

## 2026-10-08 12:09

- 改动文件夹：`pages/`（`post/`、`login/`、`profile/`、`course/`、`teacherDetail/`、`teacherResume/`、`message/`）、`utils/`（`store.js` / `auth.js`）、`server/http/`（`handlers.js`）、`server/domain/`（`notify.js`）、`server/test/`、`changelog/`
- 改动文件：`pages/post/post.wxml`、`pages/post/post.js`、`pages/login/login.wxml`、`pages/login/login.js`、`pages/profile/profile.wxml`、`pages/profile/profile.js`、`pages/course/course.js`、`pages/teacherDetail/teacherDetail.js`、`pages/teacherResume/teacherResume.js`、`pages/message/message.js`、`utils/store.js`、`utils/auth.js`、`server/http/handlers.js`、`server/domain/notify.js`、`server/test/api.test.js`、`changelog/CHANGELOG.md`
- 改了什么：把「真人聊天已删除」之后还留在界面上的入口和说法清掉：① 接单页每条单子的【先聊聊】按钮删掉（连同 `onChat` / `onChatCourse` / `openChatWith` 三个方法和单子、课程数据里没人再用的 `agentId` / `peerId` / `peerName` 字段）；② 「我的课」卡片上的【聊天】按钮删掉；③ 投递简历弹窗里那句旧的「平台确认之前聊天是「轮流一条」」提示删掉，后端 `GET /api/chats/agent/:id` 里跟着下发的 `quota` 限额字段也一起下线（`utils/store.js` 同步删掉）；④ 登录页 / 我的页 / 接单页 / 老师简历页那几句把「聊天、评价、预约、和 TA 聊聊」当成现有动作的文案，改成现在的「发布需求、投递简历、确认接单、单子状态」。
- 为什么改：用户反馈「说好聊天删了，接单页怎么还有先聊聊」——入口没删干净会让人以为真人聊天还在，也让老师以为投递之前要先跟平台私聊。对照这一条把同类残留（文案里的评价 / 预约 / 轮流一条、没人调的方法和字段）一次扫干净。
- 交互逻辑变化：老师在「接单」列表里只剩下【投递简历】（已投递就变成灰按钮）和点单子看完整需求，不再有【先聊聊】；「我的课」卡片上不再有【聊天】按钮，沟通统一走消息页的「官方助手」那一行和单子卡片（合同、收款、退款的事）。平台（学生）端看不到任何变化，页面绑定方法体检全部齐全，没有留下点不动的按钮。

## 2026-10-08 19:28

- 改动文件夹：`pages/message/`、`utils/`（`store.js`）、`server/domain/`（`agent.js`）、`server/test/`、`server/data/`（清库，不动代码）、`changelog/`
- 改动文件：`pages/message/message.wxml`、`pages/message/message.js`、`pages/message/message.wxss`、`utils/store.js`、`server/domain/agent.js`、`server/test/api.test.js`、`server/data/tutor.db`（清掉老通知 28 条 + 给 3 条老单补单号）、`changelog/CHANGELOG.md`
- 改了什么：① 消息页「我的单子」改成真正的卡片：上半张是单号 + 科目 + 上课时间，右上角是这条单子当前的状态（`st-*` 配色），下半张把这条单子**全部消息按时间正序**直接铺在卡片里（未读浅青底、有合同链接的可以点一下复制），**不再点进二级页**（`pages/postThread` 的文件留着，但消息页不再挂入口）；② `server/domain/agent.js` 的 `messageBoxes` 每张卡片多带一份 `list`（这条单子的全部消息），一次请求拿全；③ 加「隐藏」：已结束 / 已取消 / 未选上这类单子卡片底部有【隐藏】，收进标题右边的「已隐藏 N 条」里，点一下能翻出来，这张单子再来新消息会自动放出来（本机偏好，存在 `wx.storage` 的 `tutor_hidden_boxes_v1`，按老师 id 分开）；④ 标题「通知与合同」改成「通知」；⑤ 清库：删掉老库里 28 条老通知（先 `VACUUM INTO` 备份到 `server/data/tutor.db.bak-20261008-1927`），给 3 条没有单号的老单补上单号（`20260923-1` / `20261005-1` / `20261005-2`）；⑥ `server/test/api.test.js` 加一条「卡片上直接带着这条单子的消息」断言。
- 为什么改：用户说卡片「既不是聊天框，也不是卡片」，而且老通知挂在没有 `post_id` 的老单上，一张卡里只有一两条、看着像以前的记录被删了；用户要求把之前的消息删掉、新卡片把消息和状态都写在卡上、状态变化不加新卡片。隐藏则是为了让结束的单子别一直占着消息页。
- 交互逻辑变化：老师打开「消息」→「我的单子」，每条单子一张卡片，卡上直接能看到这条单子从投递到现在的每一条消息和当前状态，不用点进去；状态变化（待平台确认 → 试课中 → 主订单进行中 → 已结束）只改卡片右上角那一栏，卡片数量和位置不变。卡片底部的【隐藏】把这单收起来，标题右边出现「已隐藏 N 条」，点它就能重新铺出来；收起来之后这张单子再来新消息会自动回到列表里。另外，消息页一显示就等于看过这些卡片，有未读的卡片当场标已读，底部导航红点跟着减（卡片上的未读底色保留到下次刷新）。平台（学生）端没有卡片，仍是「通知」平铺。

## 2026-10-08 21:44

- 改动文件夹：`pages/message/`、`server/domain/`（`agent.js`）、`changelog/`
- 改动文件：`pages/message/message.js`、`pages/message/message.wxml`、`pages/message/message.wxss`、`server/domain/agent.js`、`changelog/CHANGELOG.md`
- 改了什么：消息页的单子卡片原来卡头只有单号 + 上课时间，现在把**这条单子的全部属性**都写在卡上：单号、科目（年级）、状态、谁发的 + 发布时间、上课时间、价格、位置、说明、对老师的要求（`util.requirementsText` 拼的一句话）、家长原话，然后再接这条单子的全部消息。服务端 `server/domain/agent.js` 新增 `boxPostView()`，`boxStatusOf` 改成整行取单子（原来只取 5 个字段），`messageBoxes` 每张卡片用 `Object.assign` 把单子属性铺开再挂状态和消息，`messageThread` 也跟着换成同一份属性。空着的属性（老单没有说明 / 要求 / 原话）显示「—」，要求那行空了显示「不限」，让老师能分清"这条单没写"和"页面没显示"。顺手把改过的后端重启到新代码（端口 3000，进程 17900）。
- 为什么改：用户看到卡片上「只有单号和日期」，因为卡头只印了单号 + 时间，消息又非要重启后端才带得回来；需求是卡片上就要能看全这条单子的所有信息。
- 交互逻辑变化：老师打开「消息」，每张单子卡片从上到下依次是：单号 + 科目（年级）+ 右上角状态 → 发布信息 → 上课时间 / 价格 / 位置 / 说明 / 对老师的要求 / 家长原话 → 这条单子的每一条消息 → 「共 N 条」+【隐藏】。以前要点进「单子状态」页才看得到的那些信息，现在不用点、不进二级页，在一张卡上就看全；卡片宽度不变，属性多的卡片变长，往下滑就行。

## 2026-10-08 22:10

- 改动文件夹：`pages/profile/`、`pages/post/`、根目录（`AGENTS.md`）、`changelog/`
- 改动文件：`pages/profile/profile.js`、`pages/profile/profile.wxml`、`pages/post/post.js`、`pages/post/post.wxml`、`AGENTS.md`、`changelog/CHANGELOG.md`
- 改了什么：把老师那侧的「我接单的历史」整块删掉 —— `pages/profile/profile.js` 老师分支不再拼 `history`（也不再调 `store.bookingsForTeacher` 拉一遍全部课，少一次请求），`historyTitle` / `historyEmpty` / `history` 一律置空；`pages/profile/profile.wxml` 那个历史区块的显示条件从「学生或老师」收紧成只有学生 / 平台端（「我的订单历史」照旧）。顺带把两处会把人指到「历史」的文案改掉：`pages/post/post.wxml`「我的课」那段提示和 `pages/post/post.js` 的 `coursesEmpty`，现在指向「【消息】页的单子卡片」。`AGENTS.md` 里那句「老师『我接单的历史』」也改成「已删除，别再加回来」，免得下次又被加回去。
- 为什么改：用户明确要求「接单的历史这个功能直接删除」；老师判断单子走到哪一步，现在看【接单】页的「我的课」和【消息】页那张带状态 + 全部消息的单子卡片就够了，历史区块是重复入口。
- 交互逻辑变化：老师打开「我的」页，底下不再出现「我接单的历史」那一块（以前会列出没选上 / 已取消 / 已结束的课，空的时候显示一句灰字），页面到「进行中的课 / 待平台确认」两行灰字就直接到【退出登录】；平台（学生）端完全不变，「我的订单历史」还是照旧列出发单历史和结束的订单。老师想回看某条单子的来龙去脉，去【消息】页看那张单子卡片。

## 2026-10-08 22:49

- 改动文件夹：`pages/`（删 `course/`，改 `post/`、`message/`、`profile/`）、`custom-tab-bar/`、`utils/`（`store.js`）、`server/domain/`（新建 `correct.js`，改 `agent.js`）、`server/http/`、`server/db/`（`schema.js`）、`server/test/`、根目录（`app.json`、`AGENTS.md`）、`changelog/`
- 改动文件：删除 `pages/course/course.js|.json|.wxml|.wxss`；新增 `server/domain/correct.js`；改 `app.json`、`custom-tab-bar/index.js`、`pages/post/post.js|.wxml|.wxss`、`pages/message/message.js|.wxml`、`pages/profile/profile.js|.wxml|.wxss`、`utils/store.js`、`server/domain/agent.js`、`server/http/handlers.js`、`server/http/router.js`、`server/db/schema.js`、`server/test/api.test.js`、`AGENTS.md`、`changelog/CHANGELOG.md`
- 改了什么：① **删掉课程页**（文件 + `app.json` 登记 + 底部导航那格），中介端底部只剩「工作台 / 我的」两格（`custom-tab-bar` 里 `workbench` 指向 `pages/post/post`）；② 原课程页那套「试课通过 / 确认本次 / 有异议 / 结束订单」撤掉，改成 `server/domain/correct.js` 的**修正**：`POST /api/posts/:id/correct`（改状态 / 补录线下成交订单 / 作废软删）、`POST /api/bookings/:id/correct`（改订单状态）、`GET /api/corrections`（改过几次），新增 `corrections` 表记流水，只能改自己名下的，作废不删数据；③ 中介端 `pages/post/post` 的学生分支改成**工作台**：待办（待交付→复制简历合集发家长并【已发家长】、待定老师→确认接单 / 换一位老师、待发合同、待收款）、我发布的（招募中 / 已成交，每条带【修正】弹层）、最新消息一行；④ `GET /api/messages/boxes` 从「只服务老师」放宽到登录用户（老师取 `teacher_id`、中介取 `student_id`），**中介端消息页也变成一条单子一张卡片**（带单子属性、投递条数、全部消息），挂了单子的通知不再平铺，收尾的卡片可隐藏；⑤ 「我的」页历史订单每行加【隐藏】+「已隐藏 N 条」。
- 为什么改：用户明确「小程序是中介和老师用的，家长不在里面」——课程页那一套是替家长确认课次，对中介没用；中介真正要干的是把简历交给家长、定老师、收发合同款，所以收敛成「工作台 + 我的」，其余用修正兜底。
- 交互逻辑变化：中介登录后底部只有两格，落到【工作台】：顶上「最新消息」一行（带未读），往下是【待办】卡片（先催交付简历 → 再提醒定老师 → 再提醒发合同 / 收款，点【复制简历合集】把排好版的老师简历粘到微信发给家长，发完点【已发家长】这条单就从待交付挪到待定老师；又来新简历会自动回到待交付），再往下是【我发布的】（每条带【修正】，能改状态、补录线下成交的订单、作废，弹层里能看到最近改过几次、可选「改完给老师发通知」）。消息页不再是中介的底部格子，但点工作台那行就能进，里面同样是一条单子一张卡片（状态变了只改卡片上那一栏）。【我的】页的历史订单每行能【隐藏】，标题右边「已隐藏 N 条」可翻回来。老师端（接单 / 消息 / 我的）和老师看到的卡片、我的课都没变。

## 2026-10-08 23:38

- 改动文件夹：`pages/`（新建 `workbench/`、`myPosts/`、`postManage/`，改 `post/`、`login/`，删掉 `home/`、`teacherList/` 两个空文件夹）、`utils/`（新建 `postText.js`）、`custom-tab-bar/`、根目录（`app.json`、`app.js`、`AGENTS.md`）、`changelog/`
- 改动文件：新增 `pages/workbench/workbench.js|.wxml|.wxss|.json`、`pages/myPosts/myPosts.js|.wxml|.wxss|.json`、`pages/postManage/postManage.js|.wxml|.wxss|.json`、`utils/postText.js`；改 `pages/post/post.js|.wxml|.wxss`、`app.json`、`app.js`、`custom-tab-bar/index.js`、`pages/login/login.js`、`AGENTS.md`、`changelog/CHANGELOG.md`；删除 `pages/home/`、`pages/teacherList/`（本来就是空文件夹）
- 改了什么：把上一版挤在发单页学生分支里的中介端拆成**三级页面**——一级 `pages/workbench`（工作台 tab：最新消息 + 【＋发布需求】【批量发单】+ 待办四类卡片就地操作 + 「我发布的（N 条）›」），二级 `pages/myPosts`（我发布的：按 招募中 / 已成交 / 已关闭 分组，点一条进三级），三级 `pages/postManage?postId=`（单子管理：全部属性 + 复制单号 / 需求 / 简历合集 + 撤销 + 收到的投递（看简历 / 点名字进老师资料页 / 确认接单 / 换一位老师）+ 合同收款（发合同收款码 / 确认收款 / 复制合同链接）+ 修正（改单子状态、改订单状态、补录线下订单、作废软删、修正记录、通知老师开关））。`pages/post/post` 对中介只剩发单（右上角【发布需求】弹表单 + 【批量发单】），工作台点【＋发布需求】用 `switchTab` + `globalData.publishNow` 让发单页 `onShow` 自动弹表单；`app.js` 身份一确定就把中介切到 `pages/workbench`（老师留在接单页），`login.js` 登录后同理；三段文本（单号 / 需求 / 简历合集）和「一键复制」收进新文件 `utils/postText.js`，三个页面共用；`app.json` 登记三个新页面并把 tabBar 第一格换成工作台。
- 为什么改：用户指出「工作台不应该是多级页面吗」——把待办、我发布的、修正全塞在一个页面加弹层，既不像页面结构，代码也挤在一起；拆成一级看"今天要干什么"、二级看"我发过哪些单"、三级管"这一条单"，每层只干一件事。
- 交互逻辑变化：中介点开小程序直接落在【工作台】（不再先看到发单表单）：想发单点【＋ 发布需求】，会跳到发单页并把表单弹出来；待办的每一步都能在这一屏做完（复制简历合集 / 已发家长 / 看简历 / 确认接单 / 换一位老师 / 发合同收款码 / 确认收款）；想看自己的单子点「我发布的（N 条）›」进二级页按状态翻，再点一条进三级页改状态、补录、作废、看修正记录。老师端一点没变：接单 / 消息 / 我的，仍是原来的三格与页面。

## 2026-10-09 22:49

- 改动文件夹：`utils/`、`changelog/`
- 改动文件：`utils/config.js`、`changelog/CHANGELOG.md`
- 改了什么：把 `utils/config.js` 里两处会随环境变的地址更新成当前可用的：`DEV_BASES` 第二项（手机真机用的局域网地址）从 `10.195.49.246` 换成现在网卡实际拿到的 `10.195.56.0`；`TUNNEL_BASE` 从已经失效的旧隧道换成重启 cloudflared 快速隧道后新分配的公网地址 `https://stay-moment-distribute-mounts.trycloudflare.com/api`。顺手确认后端仍在 `0.0.0.0:3000` 监听、`/api/health` 本机与公网都返回 200，隧道进程已用隐藏窗口方式在后台跑起来。
- 为什么改：这次「连不上服务器」不是代码问题，而是两个环境地址都过期了 —— 换网 / 重连后电脑的局域网 IP 变了，剩下那条写死的地址指向一台"不存在"的机器；而快速隧道的窗口一旦关掉（或重启电脑），trycloudflare 的地址就整体作废，连 DNS 都解析不出来。旧的穿透地址 `dancing-dimensional-gentleman-quarterly` 就是这样彻底打不通的。
- 交互逻辑变化：改之前，手机真机不论走哪条地址都失败，页面直接弹「连不上后端服务 …（校园网隔离时会先干等 15 秒超时）」，开发者工具里也只有本机模拟器能用；改之后，模拟器照旧走 `127.0.0.1`，手机（含 4G 或校园网 WiFi）能命中新写的局域网地址或穿透地址，冷启动、登录、发单这些请求一次就能通。以后要租带固定 IP 的腾讯轻量服务器时，只需把 `IS_DEV` 改成 `false`、`PROD_BASE` 换成自己的 https 域名即可，这套临时地址就不会再干扰。

## 2026-10-09 23:00

- 改动文件夹：`tools/`、`utils/`、根目录（三个 `.cmd` + `AGENTS.md`）、`changelog/`
- 改动文件：新增 `tools/sync-lan-ip.ps1`、`tools/tunnel-bg.ps1`；改 `tools/tunnel.ps1`、`启动后端.cmd`、`停止后端.cmd`、`安装开机自启.cmd`、`utils/config.js`（只改注释）、`AGENTS.md`、`changelog/CHANGELOG.md`
- 改了什么：①「启动后端.cmd」起后端之前先跑 `tools/sync-lan-ip.ps1`，把当前网卡的局域网 IPv4 写进 `utils/config.js` 的 `DEV_BASES` 第二项，换网 / 重连校园网不用再手改；②再用 `start /b` 后台调 `tools/tunnel-bg.ps1`，把 cloudflared 快速隧道一起拉起来（隐藏窗口、地址自动写 `TUNNEL_BASE`、已经在跑就跳过并打印当前地址）；③「停止后端.cmd」改成先停隧道再停 node，两个一起收；④「安装开机自启.cmd」生成的启动项也加上这两步；⑤三个写 config.js 的脚本（含老的 `tunnel.ps1`）全部改成 try/catch + 写后复核，写不进去就打印"手动把这一行改成什么"，不再默默报「已写入」。
- 为什么改：用户要求加固。之前重启电脑只拉起后端、隧道没起来，换网后电脑 IP 变了也得手改 config.js，于是反复出现「连不上服务器」。
- 交互逻辑变化：以前是「查看本机IP.cmd 改地址 → 启动后端 → 再双击穿透后端.cmd → 编译」四步；现在双击「启动后端.cmd」一步到位（窗口里先打印局域网地址同步结果，再打印隧道公网地址，隧道在后台跑，关掉这个窗口也不停），回开发者工具点一次「编译」即可。停止只需双击「停止后端.cmd」，后端和隧道一起停并分别提示；开机自启后同样自动带隧道。若目录没有写权限，脚本会用红字告诉你该改哪一行。

## 2026-10-10 20:27

- 改动文件夹：`utils/`、`changelog/`（后端 `server/` 与 `tools/` 脚本本身没动，只跑了一次同步脚本）
- 改动文件：`utils/config.js`（两处地址）、`changelog/CHANGELOG.md`
- 改了什么：排查「还是连不上服务器」后确认后端进程一直活着（`node` 在 `0.0.0.0:3000` 监听，`/api/health` 本机返回 200），挂的是两处环境地址。①跑 `tools/sync-lan-ip.ps1` 把 `DEV_BASES` 第二项从过期的 `http://10.195.56.0:3000/api` 更新成当前 WLAN 网卡真实拿到的 `http://10.195.51.2:3000/api`；②重开 cloudflared 快速隧道（旧进程早没了），把 `TUNNEL_BASE` 从已作废的 `https://subaru-too-sql-cds.trycloudflare.com/api` 换成新分配的 `https://romantic-rebate-passenger-toddler.trycloudflare.com/api`。新公网地址已实测 `/api/health` 返回 200。
- 为什么改：这两条地址都是「上一次会话的残留」。校园网上次拿到的是 `10.195.56.0`（本身就是个网络号，不是主机地址，必然连不上），这次换成了 `10.195.51.2`；穿透隧道是前台窗口关掉/重启电脑后就整体作废的，旧域名连 DNS 都解析不出来，手机上就会走完本机 → 穿透 → 局域网三条全失败。
- 交互逻辑变化：改之前，手机真机（4G 或校园网 WiFi）三条候选地址全军覆没，页面弹「连不上后端服务」，只有开发者工具模拟器能用（走 `127.0.0.1`）；改之后模拟器照旧，手机同一个 WiFi 命中 `10.195.51.2:3000`，跨网络时命中新的穿透地址。以后遇到同类问题，双击「启动后端.cmd」会自动同步这两条地址；如果只想修地址不动后端，可以单独跑 `tools\sync-lan-ip.ps1` 和 `tools\tunnel-bg.ps1`。

## 2026-10-10 20:37

- 改动文件夹：`changelog/`（工程内的 `server/`、`pages/`、`utils/` 代码一个字没动）；同时修了工程外的开机自启项 `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\TutorMiniBackend.cmd`
- 改动文件：`changelog/CHANGELOG.md`；重新生成开机自启项（跑 `安装开机自启.cmd`，不涉及仓库里任何文件）
- 改了什么：①查「服务器出错了」时先证明后端没病——把 `server/data/tutor.db` 连 WAL 一起复制到临时目录，用 `PORT=3100` 起了第二个后端实例，拿真实账号（学生 id1、老师 id1~4、单子 1~3、订单 1~11）压了 200 多个请求（含 5xx 扫描、脏 id、空 body、批量发单、修正、合同、课次），一条 500 都没有，`node server/test/api.test.js` 的 224 项也全过；②真正挖出来的环境坑是开机自启项停留在 2026-09-22 的旧版本（内容只有 `cd` + `node server\server.js` + `pause`），既不同步局域网 IP、也不起隧道，今天 18:44 的后端就是它拉起来的，所以地址全是旧的、手机自然连不上；已重跑 `安装开机自启.cmd` 覆盖成带「同步 IP + 后台起隧道」的新版；③顺手把当前后端换成带日志的实例（输出落到 `%TEMP%\tutormini-backend-live.log`），方便下次直接看到报错堆栈。
- 为什么改：用户反馈「还是不行，说服务器出错了」。服务端返回这句文案只有一条来源——`server/server.js` 里非 ApiError 的兜底分支（`服务器出错了：<原因>`）。要定位就得知道「原因」是什么，而原来的后端跑在 cmd 窗口里、输出没法留档；同时开机自启项这个隐患不修，下次重启电脑会再犯一次「连不上」。
- 交互逻辑变化：改之前，重启电脑后开机自启只会拉起 node，`utils/config.js` 里的局域网 IP 和穿透地址都还是上一次的旧值，手机要连只能手动双击「启动后端.cmd」；改之后，开机自启会自己同步 IP 并拉起隧道，不用再双击任何东西。另外后端现在把日志写进临时目录的文件里——用户再复现一次错误，就能直接看到是哪条请求、报了什么错，不用去读黑窗口里的红字。

## 2026-10-10 21:06

- 改动文件夹：`server/`（`server.js`、`config.js`、`db/`）、`changelog/`
- 改动文件：`server/server.js`（新增文件日志器 `createLogger` / `logFileFor`，请求行、500 堆栈、启动信息、崩溃都改成走它）、`server/config.js`（新增 `LOG_FILE` 配置项）、`server/db/sqlite.js`（开库、关库各补一次 `PRAGMA wal_checkpoint(TRUNCATE)`）、`changelog/CHANGELOG.md`
- 改了什么：两件加固。①**日志留档**：后端每条请求、每个 500 的堆栈、启动信息和「未捕获异常 / 未处理 Promise」都会追加写进数据库旁边的 `backend.log`（`LOG_FILE` 可另指定路径）；日志跟着实际打开的库走，所以跑 `server/test/api.test.js` 用的临时库只会往临时目录写，不污染开发库那一份；写不进去就自动退回「只打控制台」，不影响后端。②**WAL 合并**：开库时先做一次 checkpoint，正常关库前再做一次，把 WAL 里的数据合并回主库 `tutor.db` 并把 WAL 清空。业务逻辑、接口、文案一行没动。
- 为什么改：反复出现「连不上 / 服务器出错了」但事后查不到原因——后端跑在 cmd 窗口里，窗口一关或进程被强杀，堆栈就没了；而且强杀导致 SQLite 永远没机会 checkpoint，主库 `tutor.db` 停在 4096 字节、数据全压在 2.3MB 的 `tutor.db-wal` 里，WAL 一丢数据就没了。
- 交互逻辑变化：用起来完全没变（接口、页面、按钮都一样），变的是排查方式和数据落地。以后不管谁起的后端（双击「启动后端.cmd」、开机自启、直接跑 node），报错都会留在 `server/data/backend.log` 里，出问题直接把文件发出来就能定位。本次重启后端时那 2.3MB 的 WAL 已经合并回主库（`tutor.db` 从 4096 字节变成 143360 字节、WAL 归零），合并前先备份了一份 `server/data/tutor.db.bak-20261010-2102*`。

## 2026-10-10 23:26

- 改动文件夹：`pages/`（`workbench/`、`myPosts/`、`postManage/`、`message/`、`post/`）、`custom-tab-bar/`、`utils/`（`store.js`）、`server/`（`db/`、`domain/`、`http/`、`test/`）、根目录（`app.wxss`、`AGENTS.md`）、`changelog/`
- 改动文件：`pages/workbench/workbench.js|.wxml|.wxss`、`pages/myPosts/myPosts.js|.wxml|.wxss`、`pages/postManage/postManage.js|.wxml|.wxss`、`pages/message/message.js|.wxml|.wxss`、`pages/post/post.js`、`custom-tab-bar/index.js|.wxml`、`utils/store.js`、`app.wxss`、`server/db/schema.js`、`server/domain/notify.js`、`server/domain/posts.js`、`server/domain/bookings.js`、`server/http/handlers.js`、`server/test/api.test.js`、`AGENTS.md`、`changelog/CHANGELOG.md`
- 改了什么：① 工作台的发单入口合成一个：删掉【＋ 发布需求】按钮和 `workbench.js` 的 `onPublish`，也删掉发单页里借 `globalData.publishNow` 自动弹表单那段，只留【＋ 批量发单】占满整行；② 通知改成结果导向（`server/domain/bookings.js`）：老师撤回投递 / 平台取消某条待确认投递，既不写新通知，也靠新增的 `messages.booking_id`（`schema.js` 补列、`notify.addMessage` 第 7 个参数、`notify.removeByBooking`）把这次投递写下的两条通知一并删掉；③ 待办按「这条单还等几个投递」从多到少排（人数一样再按 交付→定老师→发合同→收款），只要有没处理的投递就一定在待办里；④ 红点铺到每一层：`GET /me/unread` 多下发 `todoPosts`（`pendingInvitePostCount`，按单子数不按投递条数），底部导航【工作台】格和工作台【待办】标题显示这个数字，待办卡 / `myPosts` 每行 + 分组标题 / `postManage` / `message` 单子卡片各带一个 `app.wxss` 里新加的 `.red-dot`。
- 为什么改：用户指出【发布需求】已被【批量发单】覆盖、多余；「投递又取消」这种不影响结果的来回不该留记录和提醒；待办要按投递人数排、不能漏单；红点数字要按「有投递的单子数」算（3 位老师投同一条单显示 1），并且这条单出现在哪一层哪一层就要有红点。
- 交互逻辑变化：改之前，工作台顶着两个发单按钮，待办按发单先后排（最新的单在最上面），中介只能从「最新消息」上的未读数知道有没有动静（3 位老师投同一条单就显示 3），一条单子撤回投递后消息页还留着「老师撤回了投递 / 投递已取消」的记录。改之后，工作台只剩一个【＋ 批量发单】；老师投得多的单自动排到待办最上面；底部导航【工作台】那格和工作台【待办】标题出现同一个数字（＝还有几条单子挂着没处理的投递），点进【我发布的】每行、再到【单子管理】、以及【消息】页那张单子卡片，都能看到同一个红点；老师投递后又撤回，消息页那张卡片、双方通知和这个数字都当没发生过。

## 2026-10-10 23:54

- 改动文件夹：`pages/`（`workbench/`、`myPosts/`、`postManage/`、`profile/`、`message/`）、`custom-tab-bar/`、`utils/`（`store.js`）、根目录（`app.json`、`AGENTS.md`）、`changelog/`
- 改动文件：`pages/workbench/workbench.js|.wxml|.wxss`、`pages/myPosts/myPosts.js|.wxml|.wxss|.json`、`pages/postManage/postManage.js|.wxml|.wxss`、`pages/profile/profile.js|.wxml|.wxss`、`pages/message/message.js|.wxml|.wxss`、`custom-tab-bar/index.js`、`utils/store.js`、`app.json`、`AGENTS.md`、`changelog/CHANGELOG.md`
- 改了什么：按"一个功能只占一个地方"把中介端拆成三个模块。① 工作台（`pages/workbench`）只留一个【＋ 批量发单】+ 待办列表，删掉「最新消息」那一行（连带 `msgUnread` / `msgLast` / `onOpenMessages` 和 `store.messages()` 那次请求）和「我发布的（N 条）」那一行；② `pages/myPosts` 升成底部第二格【单子】：按 招募中 / 已成交 / 已关闭 分组列出全部单子（行里去掉和分组重复的状态字，标题行改成 科目年级 + 单号 + 红点 的整齐排版），点进 `pages/postManage` 只看档案 —— 确认接单 / 换一位老师 / 发合同收款码 / 确认收款四个按钮和对应方法从这里撤掉（只留在工作台待办），加了"定人 / 回绝都在【工作台】待办里点"的提示；③ 中介端不再有消息页（`custom-tab-bar` 里中介三格＝工作台 / 单子 / 我的，`pages/message` 只服务老师，并撤掉上一版给中介单子卡片加的那颗红点）；④ `pages/profile` 的"订单历史 / 发单历史 + 已隐藏"整块删掉（`utils/store.js` 的 `hiddenHistory` / `saveHiddenHistory` / `tutor_hidden_history_v1` 一起下线，少两次列表请求），「我的」只剩资料 + 两行统计 + 退出登录。
- 为什么改：用户说工作台界面杂乱、消息通知和单子状态重复、待办和「我发布的」功能差不多，要求把功能区分成独立模块、不要重复。原来一条单子同时出现在待办、"我发布的"、消息页卡片三处，确认接单等按钮在待办和单子管理里各有一套，历史又在我的页再列一遍，看不出来哪个才是"该干的活"。
- 交互逻辑变化：改之前中介点开小程序看到的是：最新消息一行 + 两个发单按钮 + 待办 + 我发布的入口；消息页还铺着一串单子卡片，我的页底下还有一段订单历史。改之后点开只有一件事要先看——【工作台】顶部一个【＋ 批量发单】，下面是待办（做，一条一件事，卡片上直接点完）；想看某条单的来龙去脉点底部【单子】那格（查，按状态分组，有待办的单带红点，点进去是这条单的全部档案 + 修正兜底）；【我的】只剩自己的资料和统计。老师端一点没变（接单 / 消息 / 我的）。

