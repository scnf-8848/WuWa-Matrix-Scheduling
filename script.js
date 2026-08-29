// 图片扩展名回退列表（webp 优先）
const IMAGE_EXTENSIONS = ['webp', 'png', 'jpg', 'jpeg', 'gif'];

// 根据角色名生成头像路径
function getAvatar(name) {
  return `character/${name}.webp`;
}

// 图片加载失败时，按顺序尝试其他扩展名
function handleImgError(img) {
  const match = img.src.match(/^(.*)\.([^.]+)$/);
  if (!match) return;
  const basePath = match[1];
  const currentExt = match[2].toLowerCase();
  const currentIndex = IMAGE_EXTENSIONS.indexOf(currentExt);
  if (currentIndex >= 0 && currentIndex < IMAGE_EXTENSIONS.length - 1) {
    img.src = `${basePath}.${IMAGE_EXTENSIONS[currentIndex + 1]}`;
  }
}

// 运行态（当前用户一份）
let characters = [];
let currentSelectedRoleIndex = null;
let teams = [];
let sortableInstance = null;
let showAttr = true;
let extraUseChars = [];

// ================= 用户元数据 =================
// gameUsersMeta: { seq, currentUid, users:[{uid,name}] }
// userData_${uid}: { charData:{角色名:{owned,chain,weapon}}, teams, extraUseChars }
// globalShowAttr: 'true'/'false'（跨用户）
const META_KEY = 'gameUsersMeta';
let meta = { seq: 0, currentUid: null, users: [] };

function loadMeta() {
  try { meta = JSON.parse(localStorage.getItem(META_KEY)) || { seq: 0, currentUid: null, users: [] }; }
  catch { meta = { seq: 0, currentUid: null, users: [] }; }
}
function saveMeta() {
  localStorage.setItem(META_KEY, JSON.stringify({ seq: meta.seq, currentUid: meta.currentUid, users: meta.users }));
}
function getUser(uid) { return meta.users.find(u => u.uid === uid); }
// 持有点数：统计该用户 charData 中 owned 的角色数
function getCharCount(uid) {
  const raw = localStorage.getItem(`userData_${uid}`);
  if (!raw) return 0;
  try {
    const d = JSON.parse(raw);
    const cd = d.charData || {};
    return Object.values(cd).filter(v => v && v.owned).length;
  } catch { return 0; }
}

// 迁移旧版固定用户(1~5)到新结构，仅迁移有数据的用户
function migrateLegacy() {
  if (localStorage.getItem(META_KEY)) return;
  let seq = 0;
  const users = [];
  for (let i = 1; i <= 5; i++) {
    const charKey = `userCharacterData_${i}`;
    const gsKey = `gameScheduler_${i}`;
    const cd = localStorage.getItem(charKey);
    const gs = localStorage.getItem(gsKey);
    if (!cd && !gs) continue;
    const data = { charData: {}, teams: null, extraUseChars: [] };
    try { data.charData = JSON.parse(cd) || {}; } catch { data.charData = {}; }
    let gsData = {};
    try { gsData = gs ? JSON.parse(gs) : {}; } catch { gsData = {}; }
    data.teams = gsData.teams || Array.from({ length: 3 }, () => ({ slots: [null, null, null] }));
    data.extraUseChars = gsData.extraUseChars || [];
    localStorage.setItem(`userData_${i}`, JSON.stringify(data));
    users.push({ uid: i, name: `用户${i}` });
    seq = Math.max(seq, i);
  }
  const oldCur = parseInt(localStorage.getItem('currentUser'), 10);
  meta = {
    seq,
    currentUid: (oldCur && users.some(u => u.uid === oldCur)) ? oldCur
      : (users.length ? Math.min(...users.map(u => u.uid)) : null),
    users
  };
  saveMeta();
}

// ================= 数据读写 =================
function loadUser(uid) {
  meta.currentUid = uid;
  saveMeta();
  const raw = localStorage.getItem(`userData_${uid}`);
  let d = null;
  if (raw) { try { d = JSON.parse(raw); } catch { d = null; } }
  if (d) {
    characters = characterTemplates.map(template => {
      const uc = (d.charData && d.charData[template.name]) || { owned: false, chain: 0, weapon: 0 };
      return { ...template, avatar: getAvatar(template.name), ...uc };
    });
    teams = d.teams || Array.from({ length: 3 }, () => ({ slots: [null, null, null] }));
    extraUseChars = d.extraUseChars || [];
  } else {
    characters = characterTemplates.map(template => ({
      ...template, avatar: getAvatar(template.name), owned: false, chain: 0, weapon: 0
    }));
    teams = Array.from({ length: 3 }, () => ({ slots: [null, null, null] }));
    extraUseChars = [];
  }
}
function saveData() {
  if (meta.currentUid == null) return;
  const charData = {};
  characters.forEach(char => { charData[char.name] = { owned: char.owned, chain: char.chain, weapon: char.weapon }; });
  localStorage.setItem(`userData_${meta.currentUid}`, JSON.stringify({ charData, teams, extraUseChars }));
  saveMeta();
  localStorage.setItem('globalShowAttr', showAttr.toString());
}

// ================= 状态码编解码 =================
// base64url 字母表（URL 安全，去 '='）
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64MAP = {};
B64.split('').forEach((c, i) => { B64MAP[c] = i; });

// 生成第 n 个质数动态权重，避免角色增多时手工维护权重表
const __primes = [2];
function isPrime(x) {
  if (x < 2) return false;
  if (x % 2 === 0) return x === 2;
  for (let i = 3; i * i <= x; i += 2) if (x % i === 0) return false;
  return true;
}
function primeAt(n) {
  while (__primes.length < n) {
    let c = __primes[__primes.length - 1] + 1;
    while (!isPrime(c)) c++;
    __primes.push(c);
  }
  return __primes[n - 1];
}

// 校验和：对整段状态字符串计算，第 i 位权重 = 第 i+1 个质数
function calcChecksum(str) {
  let sum = 0;
  for (let i = 0; i < str.length; i++) {
    const cv = B64MAP[str[i]];
    if (cv === undefined) return null;
    sum = (sum + cv * primeAt(i + 1)) % 64;
  }
  return B64[sum];
}

// 已实装（id<=1000）角色子集
function implemented() { return characterTemplates.filter(t => t.id <= 1000); }

// ================= 方案一：武器有无 + bit 打包压缩 =================
// 单角色状态 4bit(0-14)：0 未持有；≥1 持有，(v-1) = chain*2 + 武器有无
// 额外疲劳值用空闲值 15(1111) 作哨兵：勾选的角色状态后追加 4bit=1111
// 不定长需加 1 字符角色数 N 前缀；新增角色天然兼容（老码 N 不含新角即未拥有）
// 版本号 v1；本地仍保留精确武器 1-5，仅分享码压缩为有无
function stateToValue(c) {
  if (!c.owned) return 0;
  return 1 + c.chain * 2 + (c.weapon > 0 ? 1 : 0);
}
function valueToState(c, v) {
  if (!v) { c.owned = false; c.chain = 0; c.weapon = 0; return; }
  c.owned = true;
  const t = v - 1;
  c.chain = Math.floor(t / 2);
  c.weapon = (t % 2 === 1) ? 1 : 0; // 有无：导出无法保留 1-5，仅有无
}

// 将任意用户库状态编码为状态码
function encodeUserState(uid) {
  const raw = localStorage.getItem(`userData_${uid}`);
  let d = {};
  if (raw) { try { d = JSON.parse(raw); } catch { d = {}; } }
  const charData = d.charData || {};
  const extraSet = new Set(d.extraUseChars || []);
  const chars = characterTemplates.map(t => {
    const uc = charData[t.name] || { owned: false, chain: 0, weapon: 0 };
    return { ...t, ...uc };
  });
  const implChars = chars.filter(c => c.id <= 1000);
  // 拼 4bit 状态 + 额外疲劳哨兵(1111)
  let bits = '';
  implChars.forEach(c => {
    const v = stateToValue(c);
    bits += String((v >> 3) & 1) + String((v >> 2) & 1) + String((v >> 1) & 1) + String(v & 1);
    if (extraSet.has(c.name)) bits += '1111';
  });
  // 6bit → 1 字符
  bits += '0'.repeat((6 - (bits.length % 6)) % 6);
  let content = '';
  for (let i = 0; i < bits.length; i += 6) content += B64[parseInt(bits.slice(i, i + 6), 2)];
  const version = 1;
  const body = B64[version] + B64[implChars.length] + content;
  return body + calcChecksum(body);
}

// 解析状态码 → {ok, version, states:[数值...], extra:Set<下标>} 或 {ok:false, error}
function decodeState(code) {
  const chars = [...code];
  if (chars.length < 4) return { ok: false, error: '分享码过短' };
  if (!(chars[0] in B64MAP)) return { ok: false, error: '无效的分享码' };
  const version = B64MAP[chars[0]];
  if (version !== 1) return { ok: false, error: `不支持的分享码版本（${version}）` };
  if (!(chars[1] in B64MAP)) return { ok: false, error: '无效的分享码' };
  const count = B64MAP[chars[1]];
  const body = chars.slice(0, -1).join('');
  const checksum = chars[chars.length - 1];
  if (calcChecksum(body) !== checksum) return { ok: false, error: '校验失败：分享码可能已损坏' };
  // content 字符展开为 bit 流
  let bits = '';
  for (let i = 2; i < chars.length - 1; i++) bits += B64MAP[chars[i]].toString(2).padStart(6, '0');
  let pos = 0;
  const read4 = () => {
    if (pos + 4 > bits.length) return null;
    const v = parseInt(bits.slice(pos, pos + 4), 2); pos += 4; return v;
  };
  const peek4 = () => (pos + 4 <= bits.length) ? parseInt(bits.slice(pos, pos + 4), 2) : null;
  // 按 N 读取状态值，peek 到 1111 即判定前一位为额外疲劳并消费
  const states = [];
  const extra = new Set();
  for (let i = 0; i < count; i++) {
    const v = read4();
    if (v === null || v > 14) return { ok: false, error: '分享码数据损坏' };
    states.push(v);
    if (peek4() === 15) { read4(); extra.add(i); }
  }
  return { ok: true, version, states, extra };
}

// 把解码结果写入指定用户的角色库（覆盖角色数据，交队伍，写额外疲劳）
function importStateToUser(uid, code) {
  const res = decodeState(code);
  if (!res.ok) return res;
  const chars = characterTemplates.map(t => ({ ...t, owned: false, chain: 0, weapon: 0 }));
  implemented().forEach((tpl, i) => {
    const c = chars.find(x => x.name === tpl.name);
    valueToState(c, i < res.states.length ? res.states[i] : 0);
  });
  const charData = {};
  chars.forEach(c => { charData[c.name] = { owned: c.owned, chain: c.chain, weapon: c.weapon }; });
  // 额外疲劳角色（按 implemented 顺序取 res.extra 下标）
  const implNames = implemented().map(t => t.name);
  const extraUseChars = [];
  res.extra.forEach(i => { const n = implNames[i]; if (n) extraUseChars.push(n); });
  let d = {};
  const raw = localStorage.getItem(`userData_${uid}`);
  if (raw) { try { d = JSON.parse(raw); } catch { d = {}; } }
  d.charData = charData;
  d.extraUseChars = extraUseChars;
  localStorage.setItem(`userData_${uid}`, JSON.stringify(d));
  return { ok: true };
}

// ================= 模态窗开关 =================
function showModal(id) { document.getElementById(id).classList.add('show'); }
function hideModal(id) { document.getElementById(id).classList.remove('show'); }

// ================= 用户管理窗口 =================
function renderUserList() {
  const list = document.getElementById('userList');
  list.innerHTML = '';

  if (meta.users.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'user-desc';
    empty.style.padding = '20px 0';
    empty.style.textAlign = 'center';
    empty.textContent = '暂无用户，请点击下方按钮添加';
    list.appendChild(empty);
  }

  meta.users.forEach(u => {
    const card = document.createElement('div');
    card.className = 'user-card' + (u.uid === meta.currentUid ? ' active' : '');
    card.dataset.uid = u.uid;

    const left = document.createElement('div');
    left.className = 'card-left';

    const nameRow = document.createElement('div');
    nameRow.className = 'name-row';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'user-name';
    nameSpan.textContent = u.name;
    const editBtn = document.createElement('button');
    editBtn.className = 'edit-btn';
    editBtn.textContent = '✎';
    editBtn.title = '重命名';
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); startRename(card, u); });
    nameRow.appendChild(nameSpan);
    nameRow.appendChild(editBtn);

    const desc = document.createElement('div');
    desc.className = 'user-desc';
    desc.textContent = `持有 ${getCharCount(u.uid)} 个角色`;

    left.appendChild(nameRow);
    left.appendChild(desc);

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    actions.appendChild(mkBtn('导入', 'btn-import', () => openImport(u.uid)));
    actions.appendChild(mkBtn('导出', 'btn-export', () => openExport(u.uid)));
    actions.appendChild(mkBtn('删除', 'btn-delete', () => openDelete(u.uid)));

    card.appendChild(left);
    card.appendChild(actions);

    // 点击卡片主体激活该用户
    card.addEventListener('click', () => {
      if (meta.currentUid !== u.uid) {
        loadUser(u.uid);
        renderUserList();
        rerenderCurrentPage();
      }
    });

    list.appendChild(card);
  });

  // 添加用户虚线框（不自动激活）
  const add = document.createElement('div');
  add.className = 'add-user';
  const addBtn = document.createElement('button');
  addBtn.textContent = '＋ 添加用户';
  addBtn.addEventListener('click', () => addNewUser());
  add.appendChild(addBtn);
  list.appendChild(add);
}

function mkBtn(text, cls, handler) {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = text;
  b.addEventListener('click', (e) => { e.stopPropagation(); handler(); });
  return b;
}

// 添加用户（新用户追加到底部，不自动设为当前）
function addUser(name, activate) {
  meta.seq += 1;
  const u = { uid: meta.seq, name };
  meta.users.push(u);
  if (activate) meta.currentUid = u.uid;
  saveMeta();
  return u.uid;
}
function addNewUser() {
  addUser(`用户${meta.seq + 1}`, false);
  renderUserList();
}

// 编辑名字
function startRename(card, u) {
  const nameSpan = card.querySelector('.user-name');
  const editBtn = card.querySelector('.edit-btn');
  const input = document.createElement('input');
  input.className = 'name-input';
  input.value = u.name;

  editBtn.replaceWith(input);
  nameSpan.replaceWith(input);
  input.focus();
  input.addEventListener('blur', () => {
    if (input.value.trim()) { u.name = input.value.trim(); saveMeta(); }
    renderUserList();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { u.name = input.value.trim() || u.name; input.value = ''; input.blur(); }
  });
}

// 导出（对指定用户）
function openExport(uid) {
  const code = encodeUserState(uid);
  document.getElementById('exportCodeLine').textContent = code;
  document.getElementById('exportUrlLine').textContent = 'https://wuwamatrix.pages.dev/import#' + code;
  showModal('exportModal');
}

// 导入（对指定用户）
let importTarget = null;
function openImport(uid) {
  importTarget = uid;
  document.getElementById('importMsg').textContent = '';
  document.getElementById('importMsg').className = 'msg';
  document.getElementById('importInput').value = '';
  showModal('importModal');
  setTimeout(() => document.getElementById('importInput').focus(), 0);
}

// 删除（二次确认）
let deleteTarget = null;
function openDelete(uid) {
  deleteTarget = uid;
  const u = getUser(uid);
  document.getElementById('deleteName').textContent = u ? u.name : '';
  showModal('deleteModal');
}

// 复制
async function copyToClipboard(text, btn) {
  const flash = (ok) => {
    const old = btn.textContent;
    btn.textContent = ok ? '已复制' : '失败';
    setTimeout(() => btn.textContent = old, 1200);
  };
  try {
    await navigator.clipboard.writeText(text);
    flash(true);
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      flash(true);
    } catch (e2) { flash(false); }
  }
}

// ================= 顶部操作 =================
function rerenderCurrentPage() {
  if (document.getElementById('teamPage').classList.contains('hidden')) renderRoleList();
  else renderTeamPage();
}

// 清空所有数据
function clearAllData() {
  if (!confirm('确定要清空所有用户数据吗？此操作将清除所有用户及其角色、队伍数据，且无法恢复。')) return;
  if (meta.users) meta.users.forEach(u => localStorage.removeItem(`userData_${u.uid}`));
  meta = { seq: 0, currentUid: null, users: [] };
  localStorage.removeItem('globalShowAttr');
  saveMeta();
  showAttr = true;
  const at = document.getElementById('attrToggle');
  if (at) at.checked = true;
  renderUserList();
  rerenderCurrentPage();
}

// 导航
document.getElementById('roleBtn').addEventListener('click', () => showPage('role'));
document.getElementById('teamBtn').addEventListener('click', () => showPage('team'));
document.getElementById('clearBtn').addEventListener('click', clearAllData);
document.getElementById('userMgrBtn').addEventListener('click', () => {
  renderUserList();
  showModal('userModal');
});

// ================= 用户管理窗口事件 =================
// data-close：仅关闭自身所在弹窗，保留父级“用户管理”窗口
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => {
    const o = btn.closest('.overlay');
    if (o) o.classList.remove('show');
  });
});
// 点击遮罩空白处关闭
document.querySelectorAll('.overlay').forEach(o => {
  o.addEventListener('mousedown', (e) => { if (e.target === o) o.classList.remove('show'); });
});
// 复制按钮
document.querySelectorAll('.copy-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const line = document.getElementById(btn.dataset.copy);
    if (line) copyToClipboard(line.textContent.trim(), btn);
  });
});
// 导入确定：接受纯状态码或含状态码的链接，自动提取'#'后的码
document.getElementById('importOk').addEventListener('click', () => {
  const val = document.getElementById('importInput').value.trim();
  const msg = document.getElementById('importMsg');
  if (!val) { msg.textContent = '请输入分享码或链接'; msg.className = 'msg err'; return; }
  if (importTarget == null) return;
  const hashIdx = val.lastIndexOf('#');
  const code = hashIdx >= 0 ? val.slice(hashIdx + 1) : val;
  const res = importStateToUser(importTarget, code);
  if (!res.ok) {
    msg.textContent = res.error;
    msg.className = 'msg err';
    return;
  }
  const u = getUser(importTarget);
  msg.textContent = `已导入到“${u ? u.name : ''}”`;
  msg.className = 'msg ok';
  renderUserList();
  if (importTarget === meta.currentUid) { loadUser(importTarget); rerenderCurrentPage(); }
  setTimeout(() => hideModal('importModal'), 900);
});
document.getElementById('importInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('importOk').click();
});
// 删除确认
document.getElementById('deleteOk').addEventListener('click', () => {
  if (deleteTarget == null) return;
  const uid = deleteTarget;
  const wasCurrent = meta.currentUid === uid;
  meta.users = meta.users.filter(u => u.uid !== uid);
  localStorage.removeItem(`userData_${uid}`);
  if (wasCurrent) {
    meta.currentUid = meta.users.length ? Math.min(...meta.users.map(u => u.uid)) : null;
    if (meta.currentUid != null) loadUser(meta.currentUid);
  }
  saveMeta();
  deleteTarget = null;
  hideModal('deleteModal');
  renderUserList();
  rerenderCurrentPage();
});

// ================= 布局：网格行数与槽位尺寸 =================
function updateLayoutScale() {
  const section = document.getElementById('teamSection');
  const cs = getComputedStyle(section);
  const padTop = parseFloat(cs.paddingTop) || 0;
  const padBottom = parseFloat(cs.paddingBottom) || 0;
  const padLeft = parseFloat(cs.paddingLeft) || 0;
  const padRight = parseFloat(cs.paddingRight) || 0;
  const availH = section.clientHeight - padTop - padBottom;
  const width = section.clientWidth - padLeft - padRight;
  const n = teams.length;
  const gap = 10;        // 垂直行间距
  const gapCols = 20;    // 两列间水平间距
  const maxSlot = 55;    // 槽位尺寸上限
  if (availH <= 0 || width <= 0) {
    section.style.setProperty('--slot-size', `${maxSlot}px`);
    return;
  }

  const naturalRow = 70;   // 队伍较少的自然行高
  const capPerCol = Math.max(1, Math.floor((availH + gap) / (naturalRow + gap)));

  const portrait = window.matchMedia('(orientation: portrait)').matches;

  let colCount;
  let perCol;
  let budgetRow;
  let overflow = false;

  if (portrait) {
    colCount = 1;
    perCol = n;
    budgetRow = 76;
  } else {
    colCount = 2;
    if (n <= capPerCol) {
      perCol = Math.max(1, n);
      budgetRow = naturalRow;
    } else if (n <= capPerCol * 2) {
      perCol = capPerCol;
      budgetRow = naturalRow;
    } else {
      overflow = true;
      perCol = Math.ceil(n / 2);
      budgetRow = (availH - (perCol - 1) * gap) / perCol;
    }
  }

  const maxPad = 20;
  const minPad = 10;
  const padV = Math.max(minPad, Math.min(maxPad,
      (budgetRow - 32) / (naturalRow - 32) * (maxPad - minPad) + minPad));

  const slotFromV = budgetRow - padV;
  const rowPad = 18;
  const colW = (width - (colCount - 1) * gapCols) / colCount;
  const slotFromW = (colW - 82 - rowPad - 16) / 3;

  let size;
  if (overflow) {
    size = Math.max(4, Math.min(slotFromV, slotFromW));
  } else {
    size = Math.max(4, Math.min(maxSlot, slotFromV, slotFromW));
  }
  const row = size + padV;

  const uiScaleSizeMin = 22;
  const uiScaleMin = 0.78;
  const uiScale = Math.max(uiScaleMin, Math.min(1,
      uiScaleMin + (size - uiScaleSizeMin) / (maxSlot - uiScaleSizeMin) * (1 - uiScaleMin)));

  section.style.setProperty('--slot-size', `${size}px`);
  section.style.setProperty('--row-pad-v', `${padV / 2}px`);
  section.style.setProperty('--row-ui-scale', `${uiScale.toFixed(3)}`);
  section.style.gridTemplateRows = `repeat(${perCol}, ${row}px)`;
  section.style.gridTemplateColumns = portrait
    ? 'minmax(0,1fr)'
    : 'minmax(0,1fr) minmax(0,1fr)';
  section.style.gridAutoFlow = 'column';
}

window.addEventListener('resize', function () {
  if (document.getElementById('teamPage').classList.contains('hidden')) return;
  updateLayoutScale();
});

function showPage(page) {
  document.getElementById('rolePage').classList.toggle('hidden', page !== 'role');
  document.getElementById('teamPage').classList.toggle('hidden', page !== 'team');
  if (page === 'role') renderRoleList();
  if (page === 'team') renderTeamPage();
}

// 空态提示（无当前用户时）
function emptyHint() {
  const h = document.createElement('div');
  h.style.cssText = 'padding:40px 0;color:#888;font-size:14px;text-align:center;grid-column:1/-1;';
  h.textContent = '暂无用户，请点击右上角“用户管理”添加或导入';
  h.style.width = '100%';
  return h;
}

// ================= 角色页面渲染 =================
function renderRoleList() {
  const list = document.getElementById('roleList');
  list.innerHTML = '';

  // 底部状态码条：随当前用户刷新，无用户时隐藏
  const statusBar = document.getElementById('leftStatusBar');
  const statusCodeEl = document.getElementById('leftStatusCode');
  if (meta.currentUid != null) {
    statusCodeEl.textContent = encodeUserState(meta.currentUid);
    statusBar.style.display = 'flex';
  } else {
    statusBar.style.display = 'none';
  }

  if (meta.currentUid == null) { list.appendChild(emptyHint()); return; }

  const ownedSection = document.createElement('div');
  ownedSection.className = 'role-section';
  ownedSection.innerHTML = '<div class="section-header"><h3>已持有</h3><button class="section-btn">全部没有</button></div><div class="role-list"></div>';

  const notOwnedSection = document.createElement('div');
  notOwnedSection.className = 'role-section';
  notOwnedSection.innerHTML = '<div class="section-header"><h3>未持有</h3><button class="section-btn">全部持有</button></div><div class="role-list"></div>';

  notOwnedSection.querySelector('.section-btn').addEventListener('click', () => {
    characters.forEach(char => { char.owned = true; });
    saveData();
    renderRoleList();
    if (document.getElementById('teamPage').classList.contains('hidden') === false) renderTeamPage();
  });

  ownedSection.querySelector('.section-btn').addEventListener('click', () => {
    characters.forEach(char => { char.owned = false; });
    teams.forEach(team => { team.slots = [null, null, null]; });
    saveData();
    renderRoleList();
    if (document.getElementById('teamPage').classList.contains('hidden') === false) renderTeamPage();
  });

  characters.forEach((char, index) => {
    const item = document.createElement('div');
    item.className = 'role-item';
    item.innerHTML = `<img src="${char.avatar}" alt="${char.name}" onerror="handleImgError(this)">`;

    const nameOverlay = document.createElement('div');
    nameOverlay.className = 'name-overlay';
    nameOverlay.textContent = char.name;
    item.appendChild(nameOverlay);

    if (showAttr) {
      const attr = document.createElement('div');
      attr.className = 'attr';
      attr.textContent = `${char.chain}+${char.weapon}`;
      item.appendChild(attr);
    }

    const statusBtn = document.createElement('div');
    statusBtn.className = `status-btn ${char.owned ? 'remove' : ''}`;
    statusBtn.textContent = char.owned ? '×' : '↑';
    statusBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const newOwned = !char.owned;
      char.owned = newOwned;
      if (!newOwned) {
        teams.forEach(team => {
          team.slots.forEach((slot, slotIndex) => {
            if (slot && slot.name === char.name) team.slots[slotIndex] = null;
          });
        });
      }
      saveData();
      renderRoleList();
      if (document.getElementById('teamPage').classList.contains('hidden') === false) renderTeamPage();
    });
    item.appendChild(statusBtn);

    item.addEventListener('click', () => showRoleDetail(index));

    if (char.owned) ownedSection.querySelector('.role-list').appendChild(item);
    else notOwnedSection.querySelector('.role-list').appendChild(item);
  });

  list.appendChild(ownedSection);
  list.appendChild(notOwnedSection);
}

function showRoleDetail(index) {
  currentSelectedRoleIndex = index;
  const char = characters[index];
  const detail = document.getElementById('roleDetail');

  let chainButtons = '';
  for (let i = 0; i <= 6; i++) {
    chainButtons += `<button class="attr-btn ${char.chain === i ? 'active' : ''}" onclick="updateChain(${index}, ${i})"><strong>${i}</strong></button>`;
  }

  let weaponButtons = '';
  for (let i = 0; i <= 5; i++) {
    weaponButtons += `<button class="attr-btn ${char.weapon === i ? 'active' : ''}" onclick="updateWeapon(${index}, ${i})"><strong>${i}</strong></button>`;
  }

  detail.innerHTML = `
    <img src="${char.avatar}" alt="${char.name}" onerror="handleImgError(this)">
    <h3>${char.name}</h3>
    <div class="attr-group">
      <label>共鸣链:</label>
      <div class="attr-buttons">${chainButtons}</div>
    </div>
    <div class="attr-group">
      <label>专武:</label>
      <div class="attr-buttons">${weaponButtons}</div>
    </div>
    <div class="attr-group">
      <label>额外疲劳值:</label>
      <input type="checkbox" id="extraUseCheckbox" ${extraUseChars.includes(char.name) ? 'checked' : ''} onchange="toggleExtraUse(${index})">
    </div>
  `;
}

function toggleOwned(index, owned) {
  const char = characters[index];
  char.owned = owned;
  if (!owned) {
    teams.forEach(team => {
      team.slots.forEach((slot, slotIndex) => {
        if (slot && slot.name === char.name) team.slots[slotIndex] = null;
      });
    });
  }
  saveData();
  renderRoleList();
  if (document.getElementById('teamPage').classList.contains('hidden') === false) renderTeamPage();
}

function updateChain(index, value) {
  characters[index].chain = parseInt(value, 10);
  saveData();
  renderRoleList();
  if (document.getElementById('teamPage').classList.contains('hidden') === false) renderTeamPage();
  if (currentSelectedRoleIndex === index) showRoleDetail(index);
}
function updateWeapon(index, value) {
  characters[index].weapon = parseInt(value, 10);
  saveData();
  renderRoleList();
  if (document.getElementById('teamPage').classList.contains('hidden') === false) renderTeamPage();
  if (currentSelectedRoleIndex === index) showRoleDetail(index);
}

function toggleExtraUse(index) {
  const char = characters[index];
  const isChecked = document.getElementById('extraUseCheckbox').checked;

  if (isChecked) {
    if (!extraUseChars.includes(char.name)) extraUseChars.push(char.name);
  } else {
    const idx = extraUseChars.indexOf(char.name);
    if (idx !== -1) {
      extraUseChars.splice(idx, 1);
      const used = teams.flatMap(team => team.slots).filter(slot => slot && slot.name === char.name).length;
      if (used > char.totalUses) {
        for (let i = teams.length - 1; i >= 0; i--) {
          let removed = false;
          for (let j = teams[i].slots.length - 1; j >= 0; j--) {
            if (teams[i].slots[j] && teams[i].slots[j].name === char.name) {
              teams[i].slots[j] = null;
              removed = true;
              break;
            }
          }
          if (removed) break;
        }
      }
    }
  }

  saveData();
  renderRoleList();
  if (document.getElementById('teamPage').classList.contains('hidden') === false) renderTeamPage();
  if (currentSelectedRoleIndex === index) showRoleDetail(index);
}

function getRemainingUses(char) {
  const used = teams.flatMap(team => team.slots).filter(slot => slot && slot.name === char.name).length;
  const total = char.totalUses + (extraUseChars.includes(char.name) ? 1 : 0);
  return Math.max(0, total - used);
}

// ================= 队伍页面渲染 =================
function renderTeamPage() {
  if (meta.currentUid == null) {
    document.getElementById('teamRoleList').innerHTML = '';
    const section = document.getElementById('teamSection');
    section.innerHTML = '';
    section.appendChild(emptyHint());
    return;
  }
  renderTeamRoleList();
  renderTeams();
}

function renderTeamRoleList() {
  const list = document.getElementById('teamRoleList');
  list.innerHTML = '';

  characters.forEach((char, index) => {
    if (!char.owned) return;
    const remaining = getRemainingUses(char);
    const item = document.createElement('div');
    item.className = 'team-role-item';
    if (remaining === 0) item.classList.add('not-available');
    item.draggable = remaining > 0;
    item.innerHTML = `<img src="${char.avatar}" alt="${char.name}" onerror="handleImgError(this)">`;

    const nameOverlay = document.createElement('div');
    nameOverlay.className = 'name-overlay';
    nameOverlay.textContent = char.name;
    item.appendChild(nameOverlay);

    if (showAttr) {
      const attr = document.createElement('div');
      attr.className = 'attr';
      attr.textContent = `${char.chain}+${char.weapon}`;
      item.appendChild(attr);
    }

    const uses = document.createElement('div');
    if (extraUseChars.includes(char.name)) uses.className = 'uses yellow';
    else uses.className = `uses ${remaining > 0 ? 'green' : 'red'}`;
    uses.textContent = `${remaining}`;
    item.appendChild(uses);

    item.addEventListener('dragstart', (e) => {
      const currentRemaining = getRemainingUses(char);
      if (currentRemaining <= 0) { e.preventDefault(); return; }
      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'character', name: char.name }));
    });

    item.addEventListener('dragover', (e) => e.preventDefault());

    item.addEventListener('click', () => {
      const currentRemaining = getRemainingUses(char);
      if (currentRemaining <= 0) return;
      let foundSlot = false;
      for (let teamIndex = 0; teamIndex < teams.length; teamIndex++) {
        const team = teams[teamIndex];
        const teamHasChar = team.slots.some(slot => slot && slot.name === char.name);
        if (teamHasChar) continue;
        for (let slotIndex = 0; slotIndex < team.slots.length; slotIndex++) {
          if (team.slots[slotIndex] === null) {
            team.slots[slotIndex] = { name: char.name };
            foundSlot = true;
            break;
          }
        }
        if (foundSlot) break;
      }
      if (foundSlot) { saveData(); renderTeamPage(); }
    });

    list.appendChild(item);
  });
}

// 渲染队伍
function renderTeams() {
  const section = document.getElementById('teamSection');
  section.innerHTML = '';

  teams.forEach((team, teamIndex) => {
    const row = document.createElement('div');
    row.className = 'team-row';

    const teamHeader = document.createElement('div');
    teamHeader.className = 'team-header';

    const handle = document.createElement('span');
    handle.className = 'team-handle';
    handle.textContent = '☰';

    const label = document.createElement('span');
    label.className = 'team-label';
    label.textContent = `队伍${teamIndex + 1}`;

    teamHeader.appendChild(handle);
    teamHeader.appendChild(label);

    const deleteTeamBtn = document.createElement('div');
    deleteTeamBtn.className = 'delete-team-btn';
    deleteTeamBtn.textContent = '×';
    deleteTeamBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (teams.length > 1) {
        teams.splice(teamIndex, 1);
        saveData();
        renderTeamPage();
      }
    });
    row.appendChild(deleteTeamBtn);

    const slotsDiv = document.createElement('div');
    slotsDiv.className = 'team-slots';

    team.slots.forEach((slot, slotIndex) => {
      const slotDiv = document.createElement('div');
      slotDiv.className = 'slot';
      slotDiv.addEventListener('dragover', (e) => e.preventDefault());
      slotDiv.addEventListener('drop', (e) => {
        e.preventDefault();
        const data = JSON.parse(e.dataTransfer.getData('text/plain'));
        if (data.type === 'character') {
          const char = characters.find(c => c.name === data.name);
          if (!char) return;
          const rem = getRemainingUses(char);
          const teamHasChar = team.slots.some(slot => slot && slot.name === char.name);
          if ((rem > 0 || (slot && slot.name === char.name)) && !teamHasChar) {
            team.slots[slotIndex] = { name: char.name };
            saveData();
            renderTeamPage();
          }
        } else if (data.type === 'slot') {
          const [fromTeam, fromSlot] = data.index;
          const fromChar = teams[fromTeam].slots[fromSlot];
          const targetTeamHasChar = teams[teamIndex].slots.some(s => s && s.name === fromChar.name);
          if (!targetTeamHasChar || fromTeam === teamIndex) {
            const temp = teams[fromTeam].slots[fromSlot];
            teams[fromTeam].slots[fromSlot] = team.slots[slotIndex];
            team.slots[slotIndex] = temp;
            saveData();
            renderTeamPage();
          }
        }
      });

      if (slot) {
        const img = document.createElement('img');
        img.src = getAvatar(slot.name);
        img.alt = slot.name;
        img.onerror = function () { handleImgError(this); };
        slotDiv.appendChild(img);

        const char = characters.find(c => c.name === slot.name);
        if (char && showAttr) {
          const attr = document.createElement('div');
          attr.className = 'attr';
          attr.textContent = `${char.chain}+${char.weapon}`;
          slotDiv.appendChild(attr);
        }

        const deleteBtn = document.createElement('div');
        deleteBtn.className = 'delete-btn';
        deleteBtn.textContent = '×';
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          team.slots[slotIndex] = null;
          saveData();
          renderTeamPage();
        });
        slotDiv.appendChild(deleteBtn);

        slotDiv.draggable = true;
        slotDiv.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'slot', index: [teamIndex, slotIndex] }));
        });
      }

      slotsDiv.appendChild(slotDiv);
    });

    row.appendChild(teamHeader);
    row.appendChild(slotsDiv);

    section.appendChild(row);
  });

  // 添加队伍按钮（放到底部工具行）
  const addTeamBtn = document.createElement('button');
  addTeamBtn.className = 'add-team-btn';
  addTeamBtn.textContent = '添加队伍';
  addTeamBtn.addEventListener('click', () => {
    teams.push({ slots: [null, null, null] });
    saveData();
    renderTeamPage();
  });
  const footer = document.querySelector('.team-footer');
  const oldAddBtn = footer.querySelector('.add-team-btn');
  if (oldAddBtn) oldAddBtn.remove();
  footer.insertBefore(addTeamBtn, footer.firstChild);

  // 初始化队伍排序
  if (sortableInstance) sortableInstance.destroy();
  sortableInstance = new Sortable(section, {
    handle: '.team-handle',
    animation: 150,
    onEnd(evt) {
      const oldIndex = evt.oldIndex;
      const newIndex = evt.newIndex;
      if (oldIndex !== newIndex && oldIndex < teams.length && newIndex < teams.length) {
        const temp = teams[oldIndex];
        teams.splice(oldIndex, 1);
        teams.splice(newIndex, 0, temp);
        saveData();
        renderTeams();
      }
    },
  });

  updateLayoutScale();
}

// ================= URL 带码访问自动导入 =================
// 形如 wuwamatrix.pages.dev/import#状态码
function handleUrlHashImport() {
  const hash = location.hash;
  if (!hash || hash.length < 2) return;
  const code = hash.slice(1);
  let matched = false;
  // 若已有用户的编码状态与链接码一致，直接激活该用户，不新建
  for (const u of meta.users) {
    if (encodeUserState(u.uid) === code) {
      loadUser(u.uid);
      matched = true;
      break;
    }
  }
  if (!matched) {
    const uid = addUser(`用户${meta.seq + 1}`, true); // 新建用户并设为当前
    const res = importStateToUser(uid, code);
    if (!res.ok) {
      // 解析失败：保留新增用户，但不写入码内数据，给出提示
      window.__lastImportError = res.error;
    }
    loadUser(uid);
  }
  // 清除 URL 中的状态码与 /import 入口路径，避免之后每次打开链接都命中分享者的数据
  const cleanPath = location.pathname.replace(/\/import$/, '') || '/';
  history.replaceState(null, '', cleanPath + location.search);
}

// ================= 初始化 =================
migrateLegacy();
loadMeta();

// 读取全局开关
const savedGlobalShowAttr = localStorage.getItem('globalShowAttr');
if (savedGlobalShowAttr !== null) showAttr = savedGlobalShowAttr === 'true';
document.getElementById('attrToggle').checked = showAttr;

// 绑定事件
document.getElementById('attrToggle').addEventListener('change', function () {
  showAttr = this.checked;
  saveData();
  rerenderCurrentPage();
});

if (meta.currentUid != null) loadUser(meta.currentUid);
handleUrlHashImport();
renderUserList();
showPage('role');