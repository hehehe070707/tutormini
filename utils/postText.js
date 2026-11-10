/*
 * 单子相关的几段固定文本 + 一键复制：发单页 / 工作台 / 单子管理页共用。
 *
 * 中介要把单号、需求、老师简历合集拿去微信发给家长和群，这几段文本必须每个页面长得
 * 一模一样（不然家长收到的版本对不上），所以统一收在这里，不要再各页复制一份。
 * 对应 Qt 版里 PostPage 里那两段拼字符串的逻辑。
 */

const util = require('./util.js');

// 复制到群里用的需求文本：单号 + 科目 + 时间 + 价格 + 位置 + 说明
function postText(item) {
  const lines = ['【单号 ' + (item.code || '') + '】' + item.subject];
  lines.push('时间：' + item.timeText);
  lines.push('价格：' + item.price);
  lines.push('位置：' + item.area);
  if (util.plain(item.note) !== '') lines.push('说明：' + item.note);
  return lines.join('\n');
}

// 复制给家长看的简历合集：还在等确认的投递一位一段
function inviteBundle(post, invites) {
  const wait = (invites || []).filter((inv) => inv.pending);
  if (wait.length === 0) return '';
  const head = '【单号 ' + (post.code || '') + '】' + post.subject + '　' + post.timeText +
    '　候选老师 ' + wait.length + ' 位：';
  const parts = wait.map((inv, index) => {
    const resume = util.plain(inv.resume) === '' ? '（这位老师没有填写简历）' : inv.resume;
    return '—— 第 ' + (index + 1) + ' 位：' + inv.teacherName + ' 老师 ——\n' + resume;
  });
  return head + '\n\n' + parts.join('\n\n');
}

// 复制到剪贴板；没内容就说一声，别让用户以为点坏了
function copyText(text, tip) {
  if (util.plain(text) === '') {
    wx.showModal({ title: '提示', content: '这条暂时没有可复制的内容。', showCancel: false });
    return;
  }
  wx.setClipboardData({
    data: text,
    success: () => wx.showToast({ title: tip || '已复制', icon: 'none' })
  });
}

module.exports = { postText, inviteBundle, copyText };
