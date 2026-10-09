// 图片扩展名回退列表（webp 优先）
const IMAGE_EXTENSIONS = ['webp', 'png', 'jpg', 'jpeg', 'gif'];

// 5 个 BOSS 的初始名称（游戏内 BOSS 更新时手动修改）
const BOSS_DEF_NAMES = ['燎照之骑', '封庭械囿', '无冠者', '天傀劫煞', '矩阵奇藏'];

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
// 页面3（BOSS 分配）：{ bossNames:[5个名称], rounds:[[{teamId,x,w}...],...] }
// x/w 为 0~1 连续比例：x=块左端占轨道宽度的比例，w=块宽度比例（宽度即该队打掉的血量占比）
let bossPage = defaultBossPage();

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

// ================= 队伍稳定 id =================
// 页面3 通过 teamId 引用队伍（而非数组下标），避免页面2 增删/调序后分配错位
function ensureTeamIds() {
  let maxId = 0;
  teams.forEach(t => { if (typeof t.id === 'number' && t.id > maxId) maxId = t.id; });
  teams.forEach(t => { if (typeof t.id !== 'number') t.id = ++maxId; });
}
function nextTeamId() {
  let maxId = 0;
  teams.forEach(t => { if (typeof t.id === 'number' && t.id > maxId) maxId = t.id; });
  return maxId + 1;
}
function getTeamById(id) { return teams.find(t => t.id === id); }

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
    bossPage = d.bossPage || null;
  } else {
    characters = characterTemplates.map(template => ({
      ...template, avatar: getAvatar(template.name), owned: false, chain: 0, weapon: 0
    }));
    teams = Array.from({ length: 3 }, () => ({ slots: [null, null, null] }));
    extraUseChars = [];
    bossPage = null;
  }
  teams.forEach(t => { if (!Array.isArray(t.slots)) t.slots = [null, null, null]; });
  ensureTeamIds();
  bossPage = normalizeBossPage(bossPage); // 过滤掉已失效的队伍引用
}
function saveData() {
  if (meta.currentUid == null) return;
  const charData = {};
  characters.forEach(char => { charData[char.name] = { owned: char.owned, chain: char.chain, weapon: char.weapon }; });
  localStorage.setItem(`userData_${meta.currentUid}`, JSON.stringify({ charData, teams, extraUseChars, bossPage }));
  saveMeta();
  localStorage.setItem('globalShowAttr', showAttr.toString());
}

// ================= 状态码编解码（v2 稠密） =================
// 分享码 = [按 6bit 打包的 base64url 载荷] + [校验和字符]
//
// 规范顺序：已实装角色（id <= 1000）按 id 升序。新增角色只会拿更大的 id，
//           所以老码永远只对应规范顺序的前若干位，新角色自动视为未持有。
//           编码只写到「最后一个持有角色」为止，其后的角色不占任何比特
//           —— 因此码里没有「角色数 N」字段，也就没有角色数上限。
//
// 载荷结构：从规范顺序第 0 位写到最后一个持有角色，逐位写 4bit 状态值：
//   0 = 未持有；1..14 = 1 + 链*2 + 专武有无
//   15(1111) 是 4bit 里的空闲值，用作哨兵：已持有角色勾了「额外疲劳」时，
//   紧跟它的 4bit 状态再写一个 1111。角色状态永远不可能是 15，
//   所以解码时「往后看 4bit」即可判定，不会与下一个角色的状态混淆。
//   （未持有角色进不了队伍，其额外疲劳勾选没有意义，不写进分享码。）
//   末尾不足 6bit 补 0；解码时多读到的 0 位会被当成「未持有」，无害。
//
// 校验和：对载荷字符做质数加权和 mod 64，权重取第 2 个质数起（3,5,7,…），
//         全为奇质数，因此任意单字符抄错都能检出。

// base64url 字母表（URL 安全，去 '='）
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64MAP = {};
B64.split('').forEach((c, i) => { B64MAP[c] = i; });

// 生成第 n 个质数动态权重，避免角色增多时手工维护权重表
const __primes = [2, 3];
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
// 权重从 primeAt(2)=3 开始，全奇质数
function calcChecksum(str) {
  let sum = 0;
  for (let i = 0; i < str.length; i++) {
    const cv = B64MAP[str[i]];
    if (cv === undefined) return null;
    sum = (sum + cv * primeAt(i + 2)) % 64;
  }
  return B64[sum];
}

// 已实装角色，按 id 升序 = 分享码规范顺序
function canonicalChars() {
  return characterTemplates.filter(t => t.id <= 1000).slice().sort((a, b) => a.id - b.id);
}

const bit4 = v => v.toString(2).padStart(4, '0');
// 单角色状态值：0 未持有；>=1 持有，(v-1) = chain*2 + 专武有无
// 链值统一钳到 0-6，避免脏数据写出超过 4bit 的值把整条流顶歪
function stateToValue(c) {
  if (!c.owned) return 0;
  const chain = Math.max(0, Math.min(6, c.chain | 0));
  return 1 + chain * 2 + (c.weapon > 0 ? 1 : 0);
}
function valueToState(c, v) {
  if (!v) { c.owned = false; c.chain = 0; c.weapon = 0; return; }
  c.owned = true;
  const t = v - 1;
  c.chain = Math.floor(t / 2);
  c.weapon = (t % 2 === 1) ? 1 : 0; // 分享码只保留「有无专武」，本地仍存 0-5
}

// 角色状态 → 比特串（每个位置固定 4bit；勾了额外疲劳的角色再跟一个 1111 哨兵）
// 额外疲劳只对「已持有」角色有意义（未持有角色进不了队伍），所以只标注已持有角色；
// 这样也不受「只写到最后一个持有角色」的截断影响（已持有角色的位置必然在范围内）。
function buildBits(chars, extraSet) {
  const last = chars.reduce((acc, c, i) => (c.owned ? i + 1 : acc), 0);
  let bits = '';
  for (let i = 0; i < last; i++) {
    bits += bit4(stateToValue(chars[i]));
    if (chars[i].owned && extraSet.has(chars[i].name)) bits += '1111';
  }
  return bits;
}

// 比特串按 6bit 打包成 base64url 字符（不足补 0；解码时多读到的 0 位会被当成"未持有"，无害）
function packBits(bits) {
  const padded = bits + '0'.repeat((6 - bits.length % 6) % 6);
  let out = '';
  for (let i = 0; i < padded.length; i += 6) out += B64[parseInt(padded.slice(i, i + 6), 2)];
  return out;
}

// 用户数据 → 分享码
function encodeUserState(uid) {
  const raw = localStorage.getItem(`userData_${uid}`);
  let d = {};
  if (raw) { try { d = JSON.parse(raw); } catch { d = {}; } }
  const charData = d.charData || {};
  const extraSet = new Set(d.extraUseChars || []);
  const chars = canonicalChars().map(t => {
    const uc = charData[t.name] || { owned: false, chain: 0, weapon: 0 };
    return { name: t.name, owned: !!uc.owned, chain: uc.chain || 0, weapon: uc.weapon || 0 };
  });
  const body = packBits(buildBits(chars, extraSet));
  return body + calcChecksum(body);
}

// 分享码 → {ok, states:[状态值...], extra:[规范序号...]}
function decodeState(code) {
  if (!code || code.length < 1) return { ok: false, error: '分享码过短' };
  const body = code.slice(0, -1);
  if (calcChecksum(body) !== code.slice(-1)) {
    return { ok: false, error: '校验失败：分享码可能已损坏，或为旧版（v1）分享码' };
  }
  let bits = '';
  for (let i = 0; i < body.length; i++) {
    const v = B64MAP[body[i]];
    if (v === undefined) return { ok: false, error: '无效的分享码' };
    bits += v.toString(2).padStart(6, '0');
  }
  let pos = 0;
  const read = n => {
    if (pos + n > bits.length) return null;
    const v = parseInt(bits.slice(pos, pos + n), 2); pos += n; return v;
  };
  const peek = n => (pos + n <= bits.length) ? parseInt(bits.slice(pos, pos + n), 2) : null;
  const states = [];
  const extra = [];
  while (pos < bits.length) {
    const v = read(4);
    if (v === null) break;
    if (v > 14) return { ok: false, error: '分享码数据损坏' };
    states.push(v);
    // 紧跟其后的 1111 是「额外疲劳」哨兵（角色状态不可能是 15）
    if (peek(4) === 15) { read(4); extra.push(states.length - 1); }
  }
  return { ok: true, states, extra };
}

// 把分享码写入指定用户的角色库（覆盖角色数据与额外疲劳，保留队伍）
function importStateToUser(uid, code) {
  const res = decodeState(code);
  if (!res.ok) return res;
  const chars = characterTemplates.map(t => ({ ...t, owned: false, chain: 0, weapon: 0 }));
  const canon = canonicalChars();
  canon.forEach((tpl, i) => {
    const c = chars.find(x => x.name === tpl.name);
    if (c) valueToState(c, i < res.states.length ? res.states[i] : 0);
  });
  const charData = {};
  chars.forEach(c => { charData[c.name] = { owned: c.owned, chain: c.chain, weapon: c.weapon }; });
  const extraUseChars = [];
  res.extra.forEach(i => { if (canon[i]) extraUseChars.push(canon[i].name); });
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
  addUser(defaultUserName(), false);
  renderUserList();
}

// 生成不重名的默认用户名：N = 当前用户数 + 1，若重名则继续 +1
function defaultUserName() {
  let n = meta.users.length + 1;
  while (meta.users.some(u => u.name === `用户${n}`)) n++;
  return `用户${n}`;
}

// 无任何用户时自动生成 1 个默认用户（新用户首访 / 删除全部用户后），并设为当前
function ensureUser() {
  if (meta.users.length > 0) return;
  addUser(defaultUserName(), true);
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
  if (!document.getElementById('teamPage').classList.contains('hidden')) renderTeamPage();
  else if (!document.getElementById('bossPage').classList.contains('hidden')) renderBossPage();
  else renderRoleList();
}

// 清空所有数据（先弹确认窗）
function clearAllData() {
  showModal('clearModal');
}
function confirmClearAll() {
  if (meta.users) meta.users.forEach(u => localStorage.removeItem(`userData_${u.uid}`));
  meta = { seq: 0, currentUid: null, users: [] };
  localStorage.removeItem('globalShowAttr');
  ensureUser(); // 清空后自动补 1 个默认用户
  loadUser(meta.currentUid);
  saveMeta();
  showAttr = true;
  const at = document.getElementById('attrToggle');
  if (at) at.checked = true;
  renderUserList();
  rerenderCurrentPage();
  hideModal('clearModal');
}

// 导航
document.getElementById('roleBtn').addEventListener('click', () => showPage('role'));
document.getElementById('teamBtn').addEventListener('click', () => showPage('team'));
document.getElementById('bossBtn').addEventListener('click', () => showPage('boss'));
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
// 分享码条导入：作用于当前用户（复用用户管理导入弹窗）
document.getElementById('leftStatusImport').addEventListener('click', (e) => {
  e.stopPropagation();
  if (meta.currentUid == null) return;
  openImport(meta.currentUid);
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
// 清空数据确认
document.getElementById('clearOk').addEventListener('click', confirmClearAll);

// 删除确认
document.getElementById('deleteOk').addEventListener('click', () => {
  if (deleteTarget == null) return;
  const uid = deleteTarget;
  const wasCurrent = meta.currentUid === uid;
  meta.users = meta.users.filter(u => u.uid !== uid);
  localStorage.removeItem(`userData_${uid}`);
  if (meta.users.length === 0) ensureUser(); // 删除全部用户后自动补 1 个
  if (wasCurrent) {
    meta.currentUid = meta.users[0].uid;
    loadUser(meta.currentUid);
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
  if (!document.getElementById('teamPage').classList.contains('hidden')) { updateLayoutScale(); return; }
  if (!document.getElementById('bossPage').classList.contains('hidden')) updateBossLayout();
});

function showPage(page) {
  localStorage.setItem('activePage', page); // 记录当前激活页面，刷新后保持
  document.getElementById('rolePage').classList.toggle('hidden', page !== 'role');
  document.getElementById('teamPage').classList.toggle('hidden', page !== 'team');
  document.getElementById('bossPage').classList.toggle('hidden', page !== 'boss');
  // 导航激活态：高亮当前页按钮
  document.getElementById('roleBtn').classList.toggle('active', page === 'role');
  document.getElementById('teamBtn').classList.toggle('active', page === 'team');
  document.getElementById('bossBtn').classList.toggle('active', page === 'boss');
  if (page === 'role') renderRoleList();
  if (page === 'team') renderTeamPage();
  if (page === 'boss') renderBossPage();
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
    item.innerHTML = `<img src="${char.avatar}" alt="${char.name}" draggable="false" onerror="handleImgError(this)">`;

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

    const statusBtn = document.createElement('button');
    statusBtn.type = 'button';
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

    // 额外疲劳角色：头像右上角黄色“+1”标识（参照队伍页 uses 样式）
    if (extraUseChars.includes(char.name)) {
      const extraBadge = document.createElement('div');
      extraBadge.className = 'uses yellow';
      extraBadge.textContent = '+1';
      item.appendChild(extraBadge);
    }

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

/* ===== 方案A：Pointer 拖拽（统一鼠标+触屏）===== */
const DRAG_THRESHOLD = 8;
// 角色项被拖拽激活后抑制随后的 click（避免拖回原处松手误触发“添加”）
let suppressCharacterClick = false;

function handleDrop(targetTeamIndex, targetSlotIndex, type, source) {
  const team = teams[targetTeamIndex];
  const slotValue = team.slots[targetSlotIndex];
  if (type === 'character') {
    const name = source.name;
    const char = characters.find(c => c.name === name);
    if (!char) return;
    const rem = getRemainingUses(char);
    const teamHasChar = team.slots.some(s => s && s.name === name);
    if ((rem > 0 || (slotValue && slotValue.name === name)) && !teamHasChar) {
      team.slots[targetSlotIndex] = { name };
      saveData(); renderTeamPage();
    }
  } else if (type === 'slot') {
    const [fromTeam, fromSlot] = source.index;
    const fromChar = teams[fromTeam].slots[fromSlot];
    if (!fromChar) return;
    const targetTeamHasChar = teams[targetTeamIndex].slots.some(s => s && s.name === fromChar.name);
    if (!targetTeamHasChar || fromTeam === targetTeamIndex) {
      const temp = teams[fromTeam].slots[fromSlot];
      teams[fromTeam].slots[fromSlot] = team.slots[targetSlotIndex];
      team.slots[targetSlotIndex] = temp;
      saveData(); renderTeamPage();
    }
  }
}

const PointerDrag = {
  pid: null, type: null, source: null, isTouch: false,
  sx: 0, sy: 0, activated: false, holdTimer: null,
  ghost: null, sourceEl: null,
  _moveB: null, _endB: null, _noScrollB: null,

  begin(e, type, source, isTouch) {
    this.pid = e.pointerId;
    this.type = type; this.source = source; this.isTouch = isTouch;
    this.sx = e.clientX; this.sy = e.clientY;
    this.activated = false; this.ghost = null;
    this.sourceEl = e.target.closest('.slot, .team-role-item');
    suppressCharacterClick = false;

    this._moveB = this._move.bind(this);
    this._endB = this._end.bind(this);
    this._noScrollB = this._noScroll.bind(this);
    window.addEventListener('pointermove', this._moveB);
    window.addEventListener('pointerup', this._endB);
    window.addEventListener('pointercancel', this._endB);

    // 触屏：长按 220ms 未滚动即启用拖拽；鼠标：靠位移阈值即时启用
    if (isTouch) {
      this.holdTimer = setTimeout(() => {
        this.holdTimer = null;
        if (!this.activated) this._activate(this.sx, this.sy);
      }, 220);
    }
  },

  _move(e) {
    if (e.pointerId !== this.pid) return;
    const dx = e.clientX - this.sx, dy = e.clientY - this.sy;
    if (this.activated) {
      this._positionGhost(e.clientX, e.clientY);
      this._highlightTarget(e.clientX, e.clientY);
      return;
    }
    if (this.isTouch) {
      // 触屏未激活：位移过大判定为「滚动」→ 取消拖拽
      if (this.holdTimer && Math.hypot(dx, dy) > 10) {
        clearTimeout(this.holdTimer); this.holdTimer = null;
        this._cancel();
      }
      return;
    }
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    this._activate(this.sx + dx, this.sy + dy);
  },

  _activate(x, y) {
    this.activated = true;
    if (this.type === 'character') suppressCharacterClick = true;
    document.body.classList.add('pointer-dragging');
    if (this.sourceEl) this.sourceEl.classList.add('drag-sourcing');
    this._makeGhost();
    this._positionGhost(x, y);
    this._highlightTarget(x, y);
    if (this.isTouch) {
      window.addEventListener('touchmove', this._noScrollB, { passive: false });
    }
  },

  _makeGhost() {
    if (!this.sourceEl) return;
    this.ghost = this.sourceEl.cloneNode(true);
    this.ghost.classList.remove('drag-sourcing');
    this.ghost.classList.add('drag-ghost');
    document.body.appendChild(this.ghost);
  },

  _positionGhost(cx, cy) {
    if (!this.ghost) return;
    const r = this.ghost.getBoundingClientRect();
    this.ghost.style.left = (cx - r.width / 2) + 'px';
    this.ghost.style.top = (cy - r.height / 2) + 'px';
  },

  _highlightTarget(cx, cy) {
    document.querySelectorAll('.slot.drag-target').forEach(s => s.classList.remove('drag-target'));
    const panel = document.querySelector('.left-panel.release-hover');
    if (panel) panel.classList.remove('release-hover');
    const el = document.elementFromPoint(cx, cy);
    if (el && el.closest('.slot')) {
      el.closest('.slot').classList.add('drag-target');
    } else if (this.type === 'slot' && el && el.closest('.left-panel')) {
      // 槽位拖到左面板 → 提示可释放回角色池
      el.closest('.left-panel').classList.add('release-hover');
    }
  },

  _noScroll(e) { e.preventDefault(); },

  _end(e) {
    if (e.pointerId !== this.pid) return;
    const wasActivated = this.activated;
    const cx = e.clientX, cy = e.clientY;
    this._cleanup();
    if (!wasActivated) return;
    const el = document.elementFromPoint(cx, cy);
    if (this.type === 'slot') {
      // 拖到队伍槽 → 换位/搬移；拖到左面板整体 → 释放回角色池
      const slot = el && el.closest('.slot');
      if (slot && slot.dataset.index) {
        const ds = slot.dataset.index.split(',').map(Number);
        handleDrop(ds[0], ds[1], 'slot', this.source);
      } else if (el && el.closest('.left-panel')) {
        const [fromTeam, fromSlot] = this.source.index;
        teams[fromTeam].slots[fromSlot] = null;
        saveData(); renderTeamPage();
      }
    } else if (this.type === 'character') {
      const slot = el && el.closest('.slot');
      if (slot && slot.dataset.index) {
        const ds = slot.dataset.index.split(',').map(Number);
        handleDrop(ds[0], ds[1], 'character', this.source);
      }
    }
  },

  _cancel() {
    this._cleanup();
  },

  _cleanup() {
    window.removeEventListener('pointermove', this._moveB);
    window.removeEventListener('pointerup', this._endB);
    window.removeEventListener('pointercancel', this._endB);
    if (this.isTouch) window.removeEventListener('touchmove', this._noScrollB, { passive: false });
    if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = null; }
    document.body.classList.remove('pointer-dragging');
    if (this.sourceEl) this.sourceEl.classList.remove('drag-sourcing');
    if (this.ghost) { this.ghost.remove(); this.ghost = null; }
    document.querySelectorAll('.slot.drag-target').forEach(s => s.classList.remove('drag-target'));
    const panel = document.querySelector('.left-panel.release-hover');
    if (panel) panel.classList.remove('release-hover');
    this.pid = null;
  }
};

function setupPointerDrag(el, type, source) {
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    PointerDrag.begin(e, type, source, e.pointerType !== 'mouse');
  });
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
    item.innerHTML = `<img src="${char.avatar}" alt="${char.name}" draggable="false" onerror="handleImgError(this)">`;

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

    // 方案A：Pointer 拖拽（触屏长按 >220ms 或鼠标拖动后启用）
    if (remaining > 0) setupPointerDrag(item, 'character', { name: char.name });

    item.addEventListener('click', () => {
      if (suppressCharacterClick) { suppressCharacterClick = false; return; } // 拖拽激活后的 click 忽略
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

    const deleteTeamBtn = document.createElement('button');
    deleteTeamBtn.type = 'button';
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
      slotDiv.dataset.index = `${teamIndex},${slotIndex}`;

      if (slot) {
        const img = document.createElement('img');
        img.src = getAvatar(slot.name);
        img.alt = slot.name;
        img.draggable = false;
        img.onerror = function () { handleImgError(this); };
        slotDiv.appendChild(img);

        const char = characters.find(c => c.name === slot.name);
        if (char && showAttr) {
          const attr = document.createElement('div');
          attr.className = 'attr';
          attr.textContent = `${char.chain}+${char.weapon}`;
          slotDiv.appendChild(attr);
        }

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'delete-btn';
        deleteBtn.textContent = '×';
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          team.slots[slotIndex] = null;
          saveData();
          renderTeamPage();
        });
        slotDiv.appendChild(deleteBtn);

        // 方案A：有角色槽位作为拖源（可换位/搬走）
        setupPointerDrag(slotDiv, 'slot', { index: [teamIndex, slotIndex] });
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
    teams.push({ id: nextTeamId(), slots: [null, null, null] });
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

// ================= 页面3：BOSS 分配（单行自由轨道） =================
// 数据模型：bossPage = { bossNames:[5], rounds:[ [ {teamId, x, w} ... ], ... ] }
//   x : 左端位置占轨道宽度比例 0~1（连续值，非列对齐）
//   w : 宽度占轨道宽度比例（连续值）——宽度即该队伍打掉的血量占比
//   多个队伍在同一 BOSS 区间内首尾相接、可跨列；跨轮次用“队伍复用（拖两次）”表达
const BOSS_MIN_W = 0.07;   // 最小宽度（比例），保证头像仍可辨认
const BOSS_DEF_W = 0.2;    // 从左侧拖入时的默认宽度（约等于一个 BOSS 列）
const r4 = v => Math.round(v * 10000) / 10000;

// 同轨道内把块排成互不重叠的占用区间（按左端升序合并）
function bossOccupied(round, excludeIndex) {
  const blocks = round
    .filter((p, i) => i !== excludeIndex)
    .map(p => ({ s: p.x, e: Math.min(1, p.x + p.w) }))
    .sort((a, b) => a.s - b.s);
  const occ = [];
  blocks.forEach(b => {
    const last = occ[occ.length - 1];
    if (last && b.s <= last.e + 1e-9) last.e = Math.max(last.e, b.e);
    else occ.push({ s: b.s, e: b.e });
  });
  return occ;
}

// 求不与同轨道其它块重叠、且离目标位置最近的左端位置；无处可放返回 null
function bossFreeX(round, x, w, excludeIndex) {
  const occ = bossOccupied(round, excludeIndex);
  const gaps = [];
  let cur = 0;
  occ.forEach(o => {
    if (o.s - cur > 1e-9) gaps.push({ s: cur, e: o.s });
    cur = Math.max(cur, o.e);
  });
  if (cur < 1 - 1e-9) gaps.push({ s: cur, e: 1 });
  let best = null, bestCost = Infinity;
  gaps.forEach(g => {
    if (g.e - g.s < w - 1e-9) return;
    const cand = Math.max(g.s, Math.min(g.e - w, x));
    const cost = Math.abs(cand - x);
    if (cost < bestCost) { bestCost = cost; best = cand; }
  });
  return best;
}

// 块左右两侧的可用边界：左邻右缘 / 右邻左缘（无邻居则 0 / 1）
function bossNeighborBounds(round, index) {
  const p = round[index];
  let left = 0, right = 1;
  round.forEach((o, i) => {
    if (i === index) return;
    if (o.x + o.w <= p.x + 1e-9) left = Math.max(left, o.x + o.w);
    else if (o.x >= p.x - 1e-9) right = Math.min(right, o.x);
  });
  return { left, right };
}

// 轨道内块与上下边缘的留白（与 styles.css 的 --track-inset 同源，保证幽灵尺寸/位置与落位一致）
function trackInset(grid) {
  const v = parseFloat(getComputedStyle(grid).getPropertyValue('--track-inset'));
  return Number.isFinite(v) ? v : 7;
}

function defaultBossPage() {
  return { bossNames: BOSS_DEF_NAMES.slice(), rounds: [[]] };
}

// 规范化：补齐 5 个 BOSS 名、过滤失效队伍引用、钳制 x/w（兼容旧的 col/span 格式）
function normalizeBossPage(bp) {
  const def = defaultBossPage();
  if (!bp) return def;
  const names = (Array.isArray(bp.bossNames) && bp.bossNames.length === 5)
    ? bp.bossNames.slice() : def.bossNames.slice();
  // 旧的占位名（BOSS-1…BOSS-5）迁移为新的默认名
  names.forEach((n, i) => { if (!n || n === `BOSS-${i + 1}`) names[i] = BOSS_DEF_NAMES[i]; });
  const validIds = new Set(teams.map(t => t.id));
  let rounds = (Array.isArray(bp.rounds) && bp.rounds.length) ? bp.rounds : [[]];
  rounds = rounds.map(r => (Array.isArray(r) ? r : []).filter(p => p && validIds.has(p.teamId))
    .map(p => {
      let x, w;
      if (typeof p.x === 'number' && typeof p.w === 'number') {
        x = p.x; w = p.w;
      } else { // 旧格式：col + span → 转成比例
        const col = Math.max(0, Math.min(4, p.col | 0));
        const span = Math.max(1, Math.min(5 - col, p.span | 0 || 1));
        x = col / 5; w = span / 5;
      }
      w = Math.max(BOSS_MIN_W, Math.min(1, w));
      x = Math.max(0, Math.min(1 - w, x));
      return { teamId: p.teamId, x: r4(x), w: r4(w) };
    }));
  if (!rounds.length) rounds = [[]];
  // 消除重叠：按左端升序依次安置，重叠的推到最近的可放位置（兼容旧版允许重叠的数据）
  rounds = rounds.map(r => {
    const out = [];
    r.slice().sort((a, b) => a.x - b.x).forEach(p => {
      const x = bossFreeX(out, p.x, p.w, -1);
      out.push({ teamId: p.teamId, x: r4(x == null ? p.x : x), w: p.w });
    });
    return out;
  });
  return { bossNames: names, rounds };
}

// 精简队伍块：3 个头像位（空位留白，整块可拖拽）
function buildTeamBlock(team) {
  const block = document.createElement('div');

  const slots = document.createElement('div');
  slots.className = 'boss-slots';
  for (let i = 0; i < 3; i++) {
    const cell = document.createElement('div');
    cell.className = 'boss-slot';
    const slot = team.slots[i];
    if (slot) {
      const img = document.createElement('img');
      img.src = getAvatar(slot.name);
      img.alt = slot.name;
      img.draggable = false;
      img.onerror = function () { handleImgError(this); };
      cell.appendChild(img);
    }
    slots.appendChild(cell);
  }
  block.appendChild(slots);
  return block;
}

function renderBossPage() {
  const teamList = document.getElementById('bossTeamList');
  const tracks = document.getElementById('bossTracks');
  const header = document.getElementById('bossHeaderRow');
  if (meta.currentUid == null) {
    header.innerHTML = '';
    teamList.innerHTML = '';
    tracks.innerHTML = '';
    teamList.appendChild(emptyHint());
    return;
  }
  renderBossTeamList();
  renderBossHeader();
  renderBossTracks();
  updateBossLayout();
}

// 左侧：仅展示非空白队伍（非完整 3 人也保留，空位留白）
function renderBossTeamList() {
  const list = document.getElementById('bossTeamList');
  list.innerHTML = '';
  const visible = teams.filter(t => t.slots && t.slots.some(s => s && s.name));
  if (!visible.length) {
    const h = document.createElement('div');
    h.className = 'boss-empty-hint';
    h.textContent = '暂无队伍，请先在“2-配队”中组建队伍';
    list.appendChild(h);
    return;
  }
  visible.forEach(team => {
    const block = buildTeamBlock(team);
    block.classList.add('boss-team');
    setupBossDrag(block, 'new-team', { teamId: team.id });
    list.appendChild(block);
  });
}

// BOSS 标题栏：5 个固定名称（不可编辑）
function renderBossHeader() {
  const row = document.getElementById('bossHeaderRow');
  row.innerHTML = '';
  bossPage.bossNames.forEach((name) => {
    const cell = document.createElement('div');
    cell.className = 'boss-name';
    cell.textContent = name;
    row.appendChild(cell);
  });
}

// 轨道：每轮一条，内部按 5 列对齐
function renderBossTracks() {
  const tracks = document.getElementById('bossTracks');
  tracks.innerHTML = '';
  bossPage.rounds.forEach((round, rIndex) => {
    const track = document.createElement('div');
    track.className = 'boss-track';
    track.dataset.round = rIndex;

    const head = document.createElement('div');
    head.className = 'track-head';
    const label = document.createElement('span');
    label.className = 'track-label';
    label.textContent = `第${rIndex + 1}轮`;
    head.appendChild(label);
    if (rIndex >= 1) { // 第 2 轮起可删除
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'track-del';
      del.textContent = '✕';
      del.title = '删除本轮';
      del.addEventListener('pointerdown', (e) => e.stopPropagation());
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        bossPage.rounds.splice(rIndex, 1);
        saveData();
        renderBossPage();
      });
      head.appendChild(del);
    }
    track.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'track-grid';
    round.forEach((p, pIndex) => {
      const team = getTeamById(p.teamId);
      if (!team) return;
      const el = buildTeamBlock(team);
      el.classList.add('placement');
      el.style.left = `${p.x * 100}%`;
      el.style.width = `${p.w * 100}%`;

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'placement-del';
      del.textContent = '✕';
      del.title = '移除';
      del.addEventListener('pointerdown', (e) => e.stopPropagation());
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        bossPage.rounds[rIndex].splice(pIndex, 1);
        saveData();
        renderBossPage();
      });
      el.appendChild(del);

      // 左右边缘拖动 → 连续调整该队占用的血量区间（不越过相邻队伍）
      const rzL = document.createElement('div');
      rzL.className = 'placement-resize placement-resize-left';
      rzL.title = '拖动调整左边界';
      rzL.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.stopPropagation();
        BossDrag.beginResize(e, rIndex, pIndex, 'left');
      });
      el.appendChild(rzL);

      const rzR = document.createElement('div');
      rzR.className = 'placement-resize placement-resize-right';
      rzR.title = '拖动调整右边界';
      rzR.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.stopPropagation();
        BossDrag.beginResize(e, rIndex, pIndex, 'right');
      });
      el.appendChild(rzR);

      setupBossDrag(el, 'move', { round: rIndex, index: pIndex });
      grid.appendChild(el);
    });
    track.appendChild(grid);
    tracks.appendChild(track);
  });
}

// 计算头像尺寸与轨道高度
function updateBossLayout() {
  const page = document.getElementById('bossPage');
  if (!page || page.classList.contains('hidden')) return;
  const grid = document.querySelector('#bossTracks .track-grid');
  const rightPanel = page.querySelector('.right-panel');
  const leftPanel = page.querySelector('.left-panel');
  const gridW = grid ? grid.clientWidth : Math.max(0, rightPanel.clientWidth - 40);
  const colW = gridW / 5;
  let slot = (colW - 16) / 3;              // 单块宽度≈一个 BOSS 列时的头像上限
  slot = Math.max(18, Math.min(52, slot));
  let teamSlot = (Math.max(0, leftPanel.clientWidth - 40) - 22) / 3;   // 22 = 队伍条内边距 12 + 边框 2 + 头像间隔 8
  teamSlot = Math.max(22, Math.min(56, teamSlot));
  document.body.style.setProperty('--boss-slot-size', `${slot}px`);
  document.body.style.setProperty('--track-h', `${slot + 16}px`);
  document.body.style.setProperty('--boss-team-slot-size', `${teamSlot}px`);
}

// 新一轮
document.getElementById('addRoundBtn').addEventListener('click', () => {
  if (meta.currentUid == null) return;
  bossPage.rounds.push([]);
  saveData();
  renderBossPage();
});

// ===== 页面3 拖拽（统一鼠标 + 触屏） =====
const BossDrag = {
  pid: null, mode: null, source: null,
  sx: 0, sy: 0, activated: false, isTouch: false,
  holdTimer: null, ghost: null, sourceEl: null, resizeSide: null,
  grabPx: 0, grabPy: 0, ghostW: 0, ghostH: 0, gridW: 1,
  _moveB: null, _endB: null, _noScrollB: null, _resizeCtx: null,

  beginMove(e, mode, source, isTouch) {
    this.pid = e.pointerId;
    this.mode = mode; this.source = source; this.isTouch = isTouch;
    this.sx = e.clientX; this.sy = e.clientY;
    this.activated = false; this.ghost = null;
    this.sourceEl = e.currentTarget;
    this._bind();
    if (isTouch) {
      this.holdTimer = setTimeout(() => {
        this.holdTimer = null;
        if (!this.activated) this._activate(this.sx, this.sy);
      }, 220);
    }
  },

  beginResize(e, rIndex, pIndex, side) {
    this.pid = e.pointerId;
    this.mode = 'resize';
    this.isTouch = e.pointerType !== 'mouse';
    this.activated = true; // 缩放立即生效
    this.resizeSide = side === 'left' ? 'left' : 'right';
    this.sourceEl = e.currentTarget.parentElement;
    this.sourceEl.classList.add('placement-resizing'); // 拖动期间锁定高亮，避免随鼠标进出块而闪烁
    this._resizeCtx = { rIndex, pIndex };
    document.body.classList.add('pointer-dragging');
    this._bind();
  },

  _bind() {
    this._moveB = this._move.bind(this);
    this._endB = this._end.bind(this);
    this._noScrollB = this._noScroll.bind(this);
    window.addEventListener('pointermove', this._moveB);
    window.addEventListener('pointerup', this._endB);
    window.addEventListener('pointercancel', this._endB);
    if (this.isTouch) window.addEventListener('touchmove', this._noScrollB, { passive: false });
  },

  _move(e) {
    if (e.pointerId !== this.pid) return;
    if (this.mode === 'resize') { this._doResize(e.clientX); return; }
    const dx = e.clientX - this.sx, dy = e.clientY - this.sy;
    if (this.activated) { this._trackGhost(e.clientX, e.clientY); return; }
    if (this.isTouch) {
      if (this.holdTimer && Math.hypot(dx, dy) > 10) { clearTimeout(this.holdTimer); this.holdTimer = null; this._cancel(); }
      return;
    }
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    this._activate(this.sx + dx, this.sy + dy);
  },

  _activate(x, y) {
    this.activated = true;
    document.body.classList.add('pointer-dragging');
    if (this.sourceEl) this.sourceEl.classList.add('drag-sourcing');
    const sr = this.sourceEl.getBoundingClientRect();
    let gw = sr.width, gh = sr.height, gridW = 0;
    if (this.mode === 'move') {
      // 同尺寸幽灵：宽度与源块一致
      const grid = this.sourceEl.closest('.track-grid');
      if (grid) gridW = grid.getBoundingClientRect().width;
    } else {
      // 从左面板新建：幽灵用落位后的真实尺寸（一个 BOSS 列宽 × 轨道高）
      const grid = document.querySelector('#bossTracks .track-grid');
      if (grid) {
        const gr = grid.getBoundingClientRect();
        gridW = gr.width;
        gw = gridW * BOSS_DEF_W;
        gh = Math.max(0, gr.height - trackInset(grid) * 2);
      }
    }
    // 抓取点相对幽灵左端/顶端的像素距离：幽灵与最终落位都用它，消除瞬移与错位
    this.ghostW = gw; this.ghostH = gh;
    this.gridW = gridW || 1;
    this.grabPx = sr.width ? (this.sx - sr.left) : gw / 2;
    this.grabPy = sr.height ? (this.sy - sr.top) : gh / 2;

    this.ghost = this.sourceEl.cloneNode(true);
    this.ghost.classList.remove('drag-sourcing');
    this.ghost.classList.add('drag-ghost');
    this.ghost.style.width = `${gw}px`;
    this.ghost.style.height = `${gh}px`;
    document.body.appendChild(this.ghost);
    this._trackGhost(x, y);
  },

  // 抓取点占轨道宽度的比例（幽灵左端 → 指针）
  get grabFrac() { return this.grabPx / this.gridW; },

  // 幽灵脱离轨道时跟随指针（保持抓取点不动）
  _freeGhost(cx, cy) {
    if (!this.ghost) return;
    this.ghost.style.left = `${cx - this.grabPx}px`;
    this.ghost.style.top = `${cy - this.grabPy}px`;
  },

  // 当前被拖块在目标轨道中的宽度与应排除的下标（同轨道移动时排除自身）
  _dragInfo(source, targetRound) {
    if (this.mode === 'new-team') return { w: BOSS_DEF_W, exclude: -1 };
    const srcRound = bossPage.rounds[source.round];
    const p = srcRound && srcRound[source.index];
    if (!p) return null;
    return { w: p.w, exclude: source.round === targetRound ? source.index : -1 };
  },

  // 幽灵跟随指针：落在轨道上时吸附到不重叠的最终位置，直观预告松手结果
  _trackGhost(cx, cy) {
    if (!this.ghost) return;
    const el = document.elementFromPoint(cx, cy);
    const leftPanel = document.querySelector('#bossPage .left-panel');
    document.querySelectorAll('.track-grid.drag-target, .track-grid.drag-blocked').forEach(g => {
      g.classList.remove('drag-target'); g.classList.remove('drag-blocked');
    });
    if (leftPanel) leftPanel.classList.remove('release-hover');

    const grid = el && el.closest('.track-grid');
    if (!grid) {
      this._freeGhost(cx, cy);
      if (this.mode === 'move' && leftPanel && leftPanel.contains(el)) leftPanel.classList.add('release-hover');
      return;
    }
    const rect = grid.getBoundingClientRect();
    const roundIdx = parseInt(grid.closest('.boss-track').dataset.round, 10);
    const round = bossPage.rounds[roundIdx];
    const info = round ? this._dragInfo(this.source, roundIdx) : null;
    const x = info ? bossFreeX(round, (cx - rect.left) / rect.width - this.grabFrac, info.w, info.exclude) : null;
    if (x == null) {
      grid.classList.add('drag-blocked'); // 放不下：不吸附，仅跟随
      this._freeGhost(cx, cy);
    } else {
      grid.classList.add('drag-target');
      this.ghost.style.left = `${rect.left + x * rect.width}px`;
      this.ghost.style.top = `${rect.top + trackInset(grid)}px`;
    }
  },

  _drop(clientX, clientY, source) {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return;
    const grid = el.closest('.track-grid');
    const leftPanel = document.querySelector('#bossPage .left-panel');

    if (grid) {
      const rect = grid.getBoundingClientRect();
      const roundIdx = parseInt(grid.closest('.boss-track').dataset.round, 10);
      const round = bossPage.rounds[roundIdx];
      const info = round ? this._dragInfo(source, roundIdx) : null;
      if (!info) return;
      const x = bossFreeX(round, (clientX - rect.left) / rect.width - this.grabFrac, info.w, info.exclude);
      if (x == null) return; // 无处可放：保持原状
      if (this.mode === 'new-team') {
        round.push({ teamId: source.teamId, x: r4(x), w: r4(info.w) });
      } else {
        const srcRound = bossPage.rounds[source.round];
        const p = srcRound && srcRound[source.index];
        if (!p) return;
        srcRound.splice(source.index, 1);
        round.push({ teamId: p.teamId, x: r4(x), w: r4(p.w) });
      }
      saveData(); renderBossPage();
    } else if (this.mode === 'move' && leftPanel && leftPanel.contains(el)) {
      // 拖回左面板（整块面板都是释放区）= 移除该分配
      const srcRound = bossPage.rounds[source.round];
      if (srcRound && srcRound[source.index]) {
        srcRound.splice(source.index, 1);
        saveData(); renderBossPage();
      }
    }
  },

  _doResize(clientX) {
    const ctx = this._resizeCtx;
    if (!ctx) return;
    const round = bossPage.rounds[ctx.rIndex];
    const p = round && round[ctx.pIndex];
    if (!p) return;
    const grid = this.sourceEl.closest('.track-grid');
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    if (!rect.width) return;
    const frac = (clientX - rect.left) / rect.width;
    const bound = bossNeighborBounds(round, ctx.pIndex);
    if (this.resizeSide === 'left') {
      // 右缘不动，左缘跟随指针；不越过左邻右缘、不低于最小宽度
      const rightEdge = p.x + p.w;
      const minX = bound.left;
      const x = Math.max(minX, Math.min(Math.max(minX, rightEdge - BOSS_MIN_W), frac));
      p.x = r4(x);
      p.w = r4(rightEdge - x);
      this.sourceEl.style.left = `${p.x * 100}%`;
      this.sourceEl.style.width = `${p.w * 100}%`;
    } else {
      // 左缘不动，右缘跟随指针；不越过右邻左缘、不低于最小宽度
      const hi = Math.min(1, bound.right);
      const rightEdge = Math.max(p.x + BOSS_MIN_W, Math.min(hi, frac));
      p.w = r4(rightEdge - p.x);
      this.sourceEl.style.width = `${p.w * 100}%`;
    }
  },

  _noScroll(e) { e.preventDefault(); },

  _end(e) {
    if (e.pointerId !== this.pid) return;
    const activated = this.activated;
    const mode = this.mode;
    const source = this.source;
    this._cleanup();
    if (!activated) return;
    if (mode === 'resize') { saveData(); return; }
    this._drop(e.clientX, e.clientY, source);
  },

  _cancel() { this._cleanup(); },

  _cleanup() {
    window.removeEventListener('pointermove', this._moveB);
    window.removeEventListener('pointerup', this._endB);
    window.removeEventListener('pointercancel', this._endB);
    if (this.isTouch) window.removeEventListener('touchmove', this._noScrollB, { passive: false });
    if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = null; }
    document.body.classList.remove('pointer-dragging');
    if (this.sourceEl) {
      this.sourceEl.classList.remove('drag-sourcing');
      this.sourceEl.classList.remove('placement-resizing');
    }
    if (this.ghost) { this.ghost.remove(); this.ghost = null; }
    document.querySelectorAll('.track-grid.drag-target, .track-grid.drag-blocked').forEach(g => {
      g.classList.remove('drag-target'); g.classList.remove('drag-blocked');
    });
    const leftPanel = document.querySelector('#bossPage .left-panel');
    if (leftPanel) leftPanel.classList.remove('release-hover');
    this.pid = null; this.source = null; this._resizeCtx = null; this.resizeSide = null;
  }
};

function setupBossDrag(el, mode, source) {
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    BossDrag.beginMove(e, mode, source, e.pointerType !== 'mouse');
  });
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
    const uid = addUser(defaultUserName(), true); // 新建用户并设为当前
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
ensureUser(); // 无用户时自动生成 1 个默认用户

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
// 首屏显示上次激活的页面（默认角色页），并持久化
const prevPage = localStorage.getItem('activePage');
showPage(['role', 'team', 'boss'].includes(prevPage) ? prevPage : 'role');