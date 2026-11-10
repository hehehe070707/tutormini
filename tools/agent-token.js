/*
 * 给外部 Agent 发一枚访问令牌（只有这一个入口，小程序里不暴露）。
 *
 * 用法（在项目根目录执行）：
 *   node tools/agent-token.js 1             # 1 = 学生（平台）账号 id
 *   node tools/agent-token.js 张三           # 也可以直接写账号姓名
 *   node tools/agent-token.js 1 我的助手     # 第二个参数是这枚令牌的备注
 *   node tools/agent-token.js --list        # 看已有的令牌（只显示摘要前 8 位，看不回原文）
 *   node tools/agent-token.js --revoke 3    # 吊销 3 号令牌
 *
 * 令牌原文只在创建时打印一次；库里存的是 SHA-256 摘要。外部 Agent 调接口时带：
 *   X-Agent-Token: <令牌原文>
 */

const config = require('../server/config.js');
const { openDatabase } = require('../server/db/index.js');
const agent = require('../server/domain/agent.js');

async function main() {
  const args = process.argv.slice(2);
  const db = await openDatabase(config);
  try {
    if (args[0] === '--list') {
      const rows = await db.all(
        `SELECT t.id, t.agent_id, t.student_id, t.label, t.revoked, t.created_at, t.last_used_at,
                substr(t.token_hash, 1, 8) AS hash8, a.name AS agent_name
         FROM agent_tokens t LEFT JOIN agents a ON a.id = t.agent_id ORDER BY t.id`
      );
      if (rows.length === 0) {
        console.log('还没有任何 Agent 令牌。');
        return;
      }
      rows.forEach((row) => {
        console.log(
          '#' + row.id + '  ' + (row.agent_name || '（未命名助手）') +
          '  token=' + row.hash8 + '…' +
          '  平台账号=' + row.student_id +
          (row.label ? '  备注=' + row.label : '') +
          (Number(row.revoked) === 1 ? '  【已吊销】' : '') +
          '  创建=' + row.created_at +
          (row.last_used_at ? '  最近使用=' + row.last_used_at : '')
        );
      });
      return;
    }

    if (args[0] === '--revoke') {
      const id = Number(args[1]);
      if (!(id > 0)) {
        console.error('用法：node tools/agent-token.js --revoke <令牌 id>');
        process.exitCode = 1;
        return;
      }
      await agent.revokeToken(db, id);
      console.log('已吊销令牌 #' + id + '。');
      return;
    }

    const who = args[0];
    if (!who) {
      console.error('用法：node tools/agent-token.js <学生账号 id 或姓名> [备注]');
      process.exitCode = 1;
      return;
    }
    const student = /^\d+$/.test(who)
      ? await db.get('SELECT * FROM students WHERE id = ?', [Number(who)])
      : await db.get('SELECT * FROM students WHERE name = ?', [who]);
    if (!student) {
      console.error('找不到这个学生（平台）账号：' + who + '。先在小程序里注册一个，或用 --list 看看。');
      process.exitCode = 1;
      return;
    }

    const info = await agent.ensureAgent(db, Number(student.id));
    const token = await agent.issueToken(db, Number(student.id), info.id, args[1] || '');
    console.log('助手已就绪：' + info.name + '（agent id = ' + info.id + '，绑定平台账号 ' +
      student.id + ' ' + student.name + '）');
    console.log('令牌（只显示这一次，请复制保存）：');
    console.log(token);
    console.log('');
    console.log('外部 Agent 调接口时带：X-Agent-Token: ' + token);
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error('出错了：' + (e && e.message ? e.message : e));
  process.exitCode = 1;
});
