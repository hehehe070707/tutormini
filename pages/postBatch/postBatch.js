const store = require('../../utils/store.js');
const util = require('../../utils/util.js');
const auth = require('../../utils/auth.js');

const GRADE_OPTIONS = util.GRADE_OPTIONS;
const GENDER_OPTIONS = util.GENDER_OPTIONS;
const EDU_OPTIONS = util.EDUCATION_LEVEL_OPTIONS;
const YEARS_OPTIONS = util.MIN_YEARS_OPTIONS;
const CERT_OPTIONS = util.REQUIRE_CERTIFICATE_OPTIONS;
const TEACH_MODE_OPTIONS = util.TEACH_MODE_OPTIONS;

let uid = 0;

function indexOfOption(options, value) {
  const index = options.indexOf(util.plain(value));
  return index < 0 ? 0 : index;
}

function looseIndex(options, value) {
  const text = util.plain(value);
  if (text === '') return 0;
  const exact = options.indexOf(text);
  if (exact >= 0) return exact;
  const aliases = [
    ['教师资格证', /教师资格|教师证/],
    ['普通话证书', /普通话/],
    ['四六级', /四六级|四级|六级|CET/],
    ['雅思托福', /雅思|托福|IELTS|TOEFL/i]
  ];
  for (let i = 0; i < aliases.length; i++) {
    const name = aliases[i][0];
    const pattern = aliases[i][1];
    if (options.indexOf(name) >= 0 && pattern.test(text)) return options.indexOf(name);
  }
  for (let i = 1; i < options.length; i++) {
    if (text.indexOf(options[i]) >= 0) return i;
  }
  return 0;
}

function yearsToIndex(value) {
  const text = util.plain(value);
  if (text === '' || text === util.REQ_UNLIMITED) return 0;
  const matched = text.match(/\d+/);
  const years = matched ? Number(matched[0]) : 0;
  if (years >= 5) return 3;
  if (years >= 3) return 2;
  if (years >= 1) return 1;
  return 0;
}

function hoursText(result) {
  const lo = Number(result && result.priceMin) || 0;
  const hi = Number(result && result.priceMax) || 0;
  if (lo <= 0 && hi <= 0) return '';
  if (lo > 0 && hi > 0 && lo !== hi) return lo + '-' + hi;
  return String(lo || hi);
}

function newRow(values) {
  uid++;
  const src = values || {};
  return {
    key: 'r' + uid,
    subject: util.plain(src.subject),
    time: util.plain(src.time),
    price: util.plain(src.price),
    area: util.plain(src.area),
    note: util.plain(src.note),

    rawText: util.plain(src.rawText),

    gradeIndex: indexOfOption(GRADE_OPTIONS, src.grade),
    genderIndex: indexOfOption(GENDER_OPTIONS, src.gender),
    educationIndex: looseIndex(EDU_OPTIONS, src.education),
    yearsIndex: yearsToIndex(src.minYears),
    certIndex: looseIndex(CERT_OPTIONS, src.certificate),
    teachModeIndex: indexOfOption(TEACH_MODE_OPTIONS, src.teachMode),

    hourly: util.plain(src.hourly),
    school: util.plain(src.school),
    externalId: util.plain(src.externalId)
  };
}

function pick(src, keys) {
  for (let i = 0; i < keys.length; i++) {
    const value = src[keys[i]];
    if (value !== undefined && value !== null && util.plain(value) !== '') return util.plain(value);
  }
  return '';
}

function rangeParts(range) {
  const text = util.plain(range).replace(/[^\d\-~～—－]/g, '');
  if (text === '') return { min: '', max: '' };
  const parts = text.split(/[-~～—－]+/);
  return { min: parts[0] || '', max: parts[1] || '' };
}

function requirementFields(item) {
  const req = (item && item.requirements) || {};
  return {
    grade: pick(item, ['grade', '年级']),
    gender: pick(req, ['gender']) || pick(item, ['gender', '性别']),
    education: pick(req, ['education']) || pick(item, ['education', '学历']),
    minYears: pick(req, ['minYears', 'min_years']) || pick(item, ['minYears', '教龄']),
    teachMode: pick(req, ['teachMode', 'teach_mode']) || pick(item, ['teachMode', '授课方式']),
    school: pick(req, ['school']) || pick(item, ['school', '学校']),
    rawText: pick(item, ['rawText', 'raw_text', '原话', '家长原话']) || pick(req, ['raw_text']),
    hourly: (function () {
      const min = pick(req, ['priceMin', 'price_min', 'budgetMin']);
      const max = pick(req, ['priceMax', 'price_max', 'budgetMax']);
      if (min === '' && max === '') return pick(item, ['hourly', 'price', '时薪', '预算']);
      return min + '-' + max;
    })(),
    certificate: (function () {
      const list = req.certificate;
      if (Array.isArray(list)) return list.join('、');
      return pick(req, ['certificate']) || pick(item, ['certificate', '证书']);
    })()
  };
}

function parseImport(text) {
  const raw = util.plain(text);
  if (raw === '') return [];
  if (raw.charAt(0) === '[' || raw.charAt(0) === '{') {
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return [];
    }
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.posts) ? data.posts : []);
    return list.map((item) => {
      const req = requirementFields(item);
      return newRow({
        subject: pick(item, ['subject', '科目']),
        time: pick(item, ['time', 'day', '时间', '上课时间']),
        price: pick(item, ['price', '价格']),
        area: pick(item, ['area', '位置']),
        note: pick(item, ['note', '备注', '说明']),
        grade: req.grade,
        gender: req.gender,
        education: req.education,
        minYears: req.minYears,
        hourly: req.hourly,
        school: req.school,
        certificate: req.certificate,
        teachMode: req.teachMode,
        rawText: req.rawText,
        externalId: pick(item, ['externalId', 'external_id', '单号'])
      });
    });
  }

  const rows = [];
  raw.split(/\r?\n/).forEach((line, index) => {
    const text2 = line.trim();
    if (text2 === '') return;
    if (index === 0 && /科目|subject/i.test(text2)) return;
    const parts = text2.split(/\t|,|，|\||｜/).map((part) => part.trim());
    if (parts.length < 1 || util.plain(parts[0]) === '') return;
    rows.push(newRow({
      subject: parts[0] || '',
      time: parts[1] || '',
      price: parts[2] || '',
      area: parts[3] || '',
      note: parts[4] || '',
      grade: parts[5] || '',
      gender: parts[6] || '',
      education: parts[7] || '',
      minYears: parts[8] || '',
      hourly: parts[9] || '',
      school: parts[10] || '',
      certificate: parts[11] || '',
      rawText: parts[12] || ''
    }));
  });
  return rows;
}

Page({
  data: {
    rows: [],
    pasteText: '',
    rawPasteText: '',
    parsingRaw: false,
    resultText: '',
    failed: [],
    submitting: false,
    gradeOptions: GRADE_OPTIONS,
    genderOptions: GENDER_OPTIONS,
    eduOptions: EDU_OPTIONS,
    yearsOptions: YEARS_OPTIONS,
    certOptions: CERT_OPTIONS,
    teachModeOptions: TEACH_MODE_OPTIONS
  },

  onLoad() {
    if (!auth.requireRole('student', 'student')) return;
    this.setData({ rows: [newRow(), newRow(), newRow()] });
  },

  onShow() {
    if (!this.data.rows || this.data.rows.length === 0) {
      if (auth.requireRole('student', 'student')) {
        this.setData({ rows: [newRow(), newRow(), newRow()] });
      }
    }
  },

  onAddRow() {
    this.setData({ rows: this.data.rows.concat([newRow()]) });
  },

  onDelRow(event) {
    const index = Number(event.currentTarget.dataset.index);
    const rows = this.data.rows.slice();
    rows.splice(index, 1);
    this.setData({ rows: rows.length > 0 ? rows : [newRow()] });
  },

  onRowInput(event) {
    const index = Number(event.currentTarget.dataset.index);
    const field = event.currentTarget.dataset.field;
    const rows = this.data.rows.slice();
    if (!rows[index]) return;
    rows[index][field] = event.detail.value;
    this.setData({ rows });
  },

  onRowPick(event) {
    const index = Number(event.currentTarget.dataset.index);
    const field = event.currentTarget.dataset.field;
    const rows = this.data.rows.slice();
    if (!rows[index]) return;
    rows[index][field] = Number(event.detail.value);
    this.setData({ rows });
  },

  onPasteInput(event) {
    this.setData({ pasteText: event.detail.value });
  },

  requirementPatch(result) {
    const req = result || {};
    return {
      genderIndex: looseIndex(GENDER_OPTIONS, req.gender),
      educationIndex: looseIndex(EDU_OPTIONS, req.education),
      yearsIndex: yearsToIndex(req.minYears),
      certIndex: looseIndex(CERT_OPTIONS, req.certificate),
      teachModeIndex: looseIndex(TEACH_MODE_OPTIONS, req.teachMode),
      hourly: hoursText(req)
    };
  },

  async onParseRow(event) {
    const index = Number(event.currentTarget.dataset.index);
    const row = this.data.rows[index];
    if (!row) return;
    const text = util.plain(row.rawText);
    if (text === '') {
      wx.showModal({ title: '提示', content: '先把这条的家长原话填上。', showCancel: false });
      return;
    }
    const result = await store.parseRequirement(text);
    this.applyParsed([index], [result], '解析完了');
  },

  async onParseAllRows() {
    if (this.data.parsingRaw) return;
    const rows = this.data.rows.slice();
    const indexes = [];
    rows.forEach((row, index) => {
      if (util.plain(row.rawText) !== '') indexes.push(index);
    });
    if (indexes.length === 0) {
      wx.showModal({ title: '提示', content: '先给至少一条填上「家长原话」。', showCancel: false });
      return;
    }
    this.setData({ parsingRaw: true });
    const list = await store.parseRequirements(indexes.map((index) => rows[index].rawText));
    this.setData({ parsingRaw: false });
    this.applyParsed(indexes, list, '解析了 ' + indexes.length + ' 条');
  },

  onRawPasteInput(event) {
    this.setData({ rawPasteText: event.detail.value });
  },

  async onParseRawPaste() {
    if (this.data.parsingRaw) return;
    const lines = util.plain(this.data.rawPasteText)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '');
    if (lines.length === 0) {
      wx.showModal({ title: '提示', content: '一行贴一条家长原话。', showCancel: false });
      return;
    }
    if (lines.length > 50) {
      wx.showModal({ title: '太多了', content: '一次最多解析 50 条，分两批吧。', showCancel: false });
      return;
    }
    this.setData({ parsingRaw: true });
    const list = await store.parseRequirements(lines);
    this.setData({ parsingRaw: false });

    const rows = lines.map((text, index) => {
      const row = newRow({ rawText: text });
      const parsed = Array.isArray(list) ? list[index] : null;
      return Object.assign(row, this.requirementPatch(parsed));
    });
    const kept = this.data.rows.filter((row) =>
      util.plain(row.subject) !== '' || util.plain(row.time) !== '' ||
      util.plain(row.note) !== '' || util.plain(row.rawText) !== '');
    this.setData({
      rows: kept.concat(rows),
      rawPasteText: '',
      resultText: '',
      failed: []
    });
    wx.showToast({ title: '导入了 ' + rows.length + ' 条', icon: 'none' });
  },

  applyParsed(indexes, list, tip) {
    const rows = this.data.rows.slice();
    let failed = 0;
    indexes.forEach((index, i) => {
      if (!rows[index]) return;
      const parsed = Array.isArray(list) ? list[i] : null;
      if (!parsed) failed++;
      Object.assign(rows[index], this.requirementPatch(parsed));
    });
    this.setData({ rows });
    wx.showToast({
      title: failed > 0 ? '有 ' + failed + ' 条没解析出来，按不限处理' : tip,
      icon: 'none'
    });
  },

  onImport() {
    const parsed = parseImport(this.data.pasteText);
    if (parsed.length === 0) {
      wx.showModal({
        title: '没解析出内容',
        content: '支持两种：1) 整段 JSON；2) 一行一条，用逗号或制表符分隔：\n科目,时间,价格,位置,备注,年级,性别,学历,教龄,时薪(如 100-150),学校,证书,家长原话',
        showCancel: false
      });
      return;
    }
    const kept = this.data.rows.filter((row) =>
      util.plain(row.subject) !== '' || util.plain(row.time) !== '' || util.plain(row.note) !== '');
    this.setData({
      rows: kept.concat(parsed),
      pasteText: '',
      resultText: '',
      failed: []
    });
    wx.showToast({ title: '导入了 ' + parsed.length + ' 条', icon: 'none' });
  },

  onClear() {
    this.setData({
      rows: [newRow(), newRow(), newRow()],
      pasteText: '',
      rawPasteText: '',
      resultText: '',
      failed: []
    });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    if (!auth.requireRole('student', 'student')) return;

    const list = [];
    this.data.rows.forEach((row) => {
      const grade = this.data.gradeOptions[row.gradeIndex];
      const gender = this.data.genderOptions[row.genderIndex];
      const hourly = rangeParts(row.hourly);
      const item = {
        subject: util.plain(row.subject),
        grade: grade === '不限' ? '' : grade,
        gender: gender === '不限' ? '' : gender,
        time: util.plain(row.time),
        price: util.plain(row.price),
        area: util.plain(row.area),
        note: util.plain(row.note),
        externalId: util.plain(row.externalId),
        rawText: util.plain(row.rawText),
        requirements: {

          gender,
          education: this.data.eduOptions[row.educationIndex],
          minYears: this.data.yearsOptions[row.yearsIndex],
          certificate: this.data.certOptions[row.certIndex],
          teachMode: this.data.teachModeOptions[row.teachModeIndex],

          priceMin: hourly.min,
          priceMax: hourly.max,
          school: util.plain(row.school)
        }
      };
      if (item.subject !== '' || item.time !== '' || item.note !== '' || item.rawText !== '') list.push(item);
    });
    if (list.length === 0) {
      wx.showModal({ title: '提示', content: '先填至少一条（科目和上课时间必填）。', showCancel: false });
      return;
    }
    if (list.length > 50) {
      wx.showModal({ title: '太多了', content: '一次最多发 50 条，分两批发吧。', showCancel: false });
      return;
    }

    this.setData({ submitting: true });
    const data = await store.batchCreatePosts(list);
    this.setData({ submitting: false });
    if (!data) {
      wx.showModal({ title: '发布失败', content: store.lastError, showCancel: false });
      return;
    }

    const okCount = data.ok.length;
    const failed = data.failed.map((item) => ({
      label: '第 ' + (Number(item.index) + 1) + ' 条',
      reason: item.reason
    }));
    this.setData({
      resultText: okCount > 0
        ? '成功发布 ' + okCount + ' 条' + (failed.length > 0 ? '，失败 ' + failed.length + ' 条。' : '。')
        : '一条都没发出去，原因看下面。',
      failed
    });
    if (failed.length === 0) {
      wx.showToast({ title: '已发布 ' + okCount + ' 条', icon: 'success' });
    }
  },

  onBack() {
    wx.navigateBack();
  }
});
