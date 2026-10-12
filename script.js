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
let showAttr = true;
let showScore = true;   // 页面3 右面板：是否在队伍块上方显示分数（全局开关）
let extraUseChars = [];
// 页面3（BOSS 分配）：{ bossNames:[5个名称], rounds:[[{teamId,x,w}...],...] }
// x/w 为 0~1 连续比例：x=块左端占轨道宽度的比例，w=块宽度比例（宽度即该队打掉的血量占比）
let bossPage = defaultBossPage();
// 队伍 id 计数器：单调只增、随用户持久化。删除队伍后新队伍不再复用旧 id，
// 避免页面3 里引用旧 id 的块静默错绑到新队伍。
let teamIdSeq = 0;

// ================= 用户元数据 =================
// gameUsersMeta: { seq, currentUid, users:[{uid,name}] }
// userData_${uid}: { charData:{角色名:{owned,chain,weapon}}, teams, extraUseChars, bossPage, teamIdSeq }
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
    // 目标键已存在则不覆盖：绝不用旧版数据（无 bossPage、队伍无 id）抹掉已存在的数据
    if (localStorage.getItem(`userData_${i}`) == null) {
      localStorage.setItem(`userData_${i}`, JSON.stringify(data));
    }
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
  seedTeamIdSeq();
  teams.forEach(t => { if (typeof t.id !== 'number') t.id = ++teamIdSeq; });
}
// 把计数器抬到不低于「现存队伍 id」与「页面3 仍引用的队伍 id」的最大值：
// 前者避免与在用队伍撞号；后者避免新队伍复用旧 id、把页面3 里残留的失效块错绑成有效块。
function seedTeamIdSeq() {
  let maxId = teamIdSeq;
  teams.forEach(t => { if (typeof t.id === 'number' && t.id > maxId) maxId = t.id; });
  const rounds = (bossPage && bossPage.rounds) || [];
  rounds.forEach(r => (Array.isArray(r) ? r : []).forEach(p => {
    if (p && typeof p.teamId === 'number' && p.teamId > maxId) maxId = p.teamId;
  }));
  teamIdSeq = maxId;
}
function nextTeamId() {
  seedTeamIdSeq();
  return ++teamIdSeq; // 单调只增：已用过的 id 绝不回收
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
  teamIdSeq = d ? (Number(d.teamIdSeq) || 0) : 0; // 恢复该用户的 id 计数器（旧数据无此字段 → 0）
  ensureTeamIds();
  bossPage = normalizeBossPage(bossPage); // 规整格式；失效的队伍引用保留，不在此处删除
}
function saveData() {
  if (meta.currentUid == null) return;
  pruneContinuations(); // 续接链失效的后续块一并清理，保证存盘、内存与界面三者一致
  const charData = {};
  characters.forEach(char => { charData[char.name] = { owned: char.owned, chain: char.chain, weapon: char.weapon }; });
  localStorage.setItem(`userData_${meta.currentUid}`, JSON.stringify({ charData, teams, extraUseChars, bossPage, teamIdSeq }));
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
  // uid 必须避开任何已存在的 userData_ 键（含历史遗留的孤儿键）：
  // 否则新用户会直接继承那份数据，而不是从空白开始
  do { meta.seq += 1; } while (localStorage.getItem(`userData_${meta.seq}`) != null);
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
  localStorage.removeItem('globalShowScore');
  ensureUser(); // 清空后自动补 1 个默认用户
  loadUser(meta.currentUid);
  saveMeta();
  showAttr = true;
  const at = document.getElementById('attrToggle');
  if (at) at.checked = true;
  showScore = true;
  const st = document.getElementById('scoreToggle');
  if (st) st.checked = true;
  applyScoreVisibility();
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
/* 页面2 队伍排布规则：
   1. 横屏固定保持两列网格，队伍先填满左列、余数才进右列：每列行数取不压缩、不滚动前提下
      的容量（TL_NATURAL_ROW 支撑的行数），而不是两列均分。左列靠最左，右列即使空着也保留
      轨道位置 —— 这样队伍增加、右列开始出现时，已排好的左列不会移动。
   2. 行高吃满可用高度（上限 TL_MAX_ROW），而不是钉死在自然行高上，避免底部集中留白；
      行高有富余时把整块网格垂直居中，让留白上下均分。
   3. 两列并不总是更优：列宽被压窄时头像会变小。故同时试算单列，取可读性更好的方案；
      两列既没换来更大头像、又在纵向浪费超过 1/4 高度时，改单列。
   4. 若最好的方案仍低于可读下限 TL_MIN_SLOT，放弃“一屏全显”，改用固定舒适行高并允许纵向滚动。
   5. 单列时队伍块不拉满整行：宽度收到“刚好不再被宽度限制”的 TL_ROW_MAX_W 并水平居中。 */
const TL_MIN_SLOT = 28;    // 头像位可读下限
const TL_MAX_SLOT = 55;    // 头像位上限
const TL_MAX_ROW = 78;     // 行高上限：避免队伍块被拉得过分空旷
const TL_SCROLL_ROW = 60;  // 滚动模式行高（与 .team-row 的 min-height 一致）
const TL_NATURAL_ROW = 70; // 自然行高：低于它即视为“压缩了队伍块”
const TL_GAP = 10;         // 行距
const TL_GAP_COLS = 20;    // 列距
const TL_FIXED_W = 116;    // 每行除头像位外的固定宽度（把手 + 队伍名 + 内边距 + 头像间隔）
const TL_ROW_MAX_W = TL_FIXED_W + 3 * TL_MAX_SLOT; // 单列队伍块的最大宽度：再宽也换不来更大的头像

// 试算某一列数方案：返回头像位尺寸、行高与内容总高。
// opts.perCol 可指定每列行数（容量优先排布）；opts.row 可强制行高（滚动兜底）。
function teamLayoutCandidate(colCount, availH, width, n, opts) {
  const o = opts || {};
  const perCol = o.perCol != null ? o.perCol : Math.max(1, Math.ceil(n / colCount));
  const rowBudget = o.row != null
    ? o.row
    : Math.min(TL_MAX_ROW, (availH - (perCol - 1) * TL_GAP) / perCol);
  const padV = Math.max(10, Math.min(20,
      (rowBudget - 32) / (TL_NATURAL_ROW - 32) * 10 + 10));
  const colW = (width - (colCount - 1) * TL_GAP_COLS) / colCount;
  const slotFromV = rowBudget - padV;
  const slotFromW = (colW - TL_FIXED_W) / 3;
  const slot = Math.max(4, Math.min(TL_MAX_SLOT, slotFromV, slotFromW));
  return {
    colCount, perCol, padV, slot, rowBudget,
    // 头像位是被列宽卡住的（而非行高/上限）：此时减列才可能换来更大头像
    widthLimited: slotFromW < slotFromV && slotFromW < TL_MAX_SLOT,
    contentH: perCol * rowBudget + (perCol - 1) * TL_GAP
  };
}

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
  if (availH <= 0 || width <= 0) {
    section.style.setProperty('--slot-size', `${TL_MAX_SLOT}px`);
    return;
  }

  const portrait = window.matchMedia('(orientation: portrait)').matches;
  let best;
  let scroll = false;

  if (portrait) {
    // 竖屏：单列、固定行高，超出部分由竖屏媒体查询里的 overflow-y 承载
    best = teamLayoutCandidate(1, availH, width, n, { row: 76 });
  } else {
    // 容量优先：不压缩队伍块（行高不低于自然行高）时，一列最多能放几行
    const capNat = Math.max(1, Math.floor((availH + TL_GAP) / (TL_NATURAL_ROW + TL_GAP)));
    // 先尽量排满左列，再把余数放进右列；只有两列都装不下才回到均分并压缩
    const twoPerCol = n <= capNat ? n
      : (n <= capNat * 2 ? capNat : Math.ceil(n / 2));
    const two = teamLayoutCandidate(2, availH, width, n, { perCol: twoPerCol });
    const one = teamLayoutCandidate(1, availH, width, n);
    best = two;
    const slack = 1 - two.contentH / availH;   // 两列方案在纵向浪费掉的比例
    // 改单列的三条理由：单列明显更清晰；两列已小到不可读而单列更大；
    // 两列被列宽卡住、既没换来更大头像又在纵向浪费超过 1/4 高度。
    // 注意：队伍数少、右列空着时仍保持两列（左列靠左不动），不因此改单列。
    if (one.slot > two.slot * 1.15
        || (two.slot < TL_MIN_SLOT && one.slot > two.slot)
        || (two.widthLimited && one.slot >= two.slot && slack > 0.25)) {
      best = one;
    }
    if (best.slot < TL_MIN_SLOT) {
      // 两列也太小：给足舒适行高，超出部分改为滚动
      scroll = true;
      best = teamLayoutCandidate(best.colCount, availH, width, n,
        { row: TL_SCROLL_ROW, perCol: best.perCol });
    }
  }

  const uiScale = Math.max(0.78, Math.min(1,
      0.78 + (best.slot - 22) / (TL_MAX_SLOT - 22) * (1 - 0.78)));

  section.style.setProperty('--slot-size', `${best.slot}px`);
  section.style.setProperty('--row-pad-v', `${best.padV / 2}px`);
  section.style.setProperty('--row-ui-scale', `${uiScale.toFixed(3)}`);
  section.style.gridTemplateRows = `repeat(${best.perCol}, ${best.rowBudget}px)`;
  // 两列：始终保留两条轨道（左列靠最左）；单列：宽度收到上限，不拉满整行，整体水平居中
  section.style.gridTemplateColumns = best.colCount === 1
    ? `min(100%, ${TL_ROW_MAX_W}px)`
    : 'minmax(0,1fr) minmax(0,1fr)';
  section.style.justifyContent = best.colCount === 1 ? 'center' : '';
  section.style.gridAutoFlow = 'column';
  // 内容不足一屏 → 垂直居中（留白上下均分）；满屏或滚动 → 顶部对齐
  section.style.alignContent = (!scroll && best.contentH < availH - 2) ? 'center' : 'start';
  section.classList.toggle('team-scroll', scroll);
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
    setReleaseHoverOverlay(null, false);
    const el = document.elementFromPoint(cx, cy);
    if (el && el.closest('.slot')) {
      el.closest('.slot').classList.add('drag-target');
    } else if (this.type === 'slot' && el && el.closest('.left-panel')) {
      // 槽位拖到左面板 → 提示可释放回角色池
      setReleaseHoverOverlay(el.closest('.left-panel'), true);
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
    setReleaseHoverOverlay(null, false);
    this.pid = null;
  }
};

function setupPointerDrag(el, type, source) {
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    PointerDrag.begin(e, type, source, e.pointerType !== 'mouse');
  });
}

/* ===== 页面2：队伍块整行拖动排序（2 列网格、列优先填充）=====
   自定义实现以精确控制「目标落位」：参考页面3 BossDrag 的指针拖拽写法。
   关键：落位按网格的「列 × 行」计算，避免把「左列最后一行」错判成「右列第一行」。 */
const TeamDrag = {
  pid: null, teamIndex: null, isTouch: false,
  sx: 0, sy: 0, activated: false, holdTimer: null,
  ghost: null, sourceEl: null, placeholder: null,
  grabPx: 0, grabPy: 0, targetIndex: null,
  _moveB: null, _endB: null, _noScrollB: null,

  begin(e, teamIndex, sourceEl, isTouch) {
    this.pid = e.pointerId;
    this.teamIndex = teamIndex;
    this.sourceEl = sourceEl;
    this.isTouch = isTouch;
    this.sx = e.clientX; this.sy = e.clientY;
    this.activated = false; this.ghost = null; this.placeholder = null;
    this.targetIndex = teamIndex;

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
      this._updatePlaceholder(e.clientX, e.clientY);
      return;
    }
    if (this.isTouch) {
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
    if (!this.sourceEl) return;
    this.activated = true;
    document.body.classList.add('pointer-dragging');
    const r = this.sourceEl.getBoundingClientRect();
    // 抓取点相对幽灵左上角的像素偏移：幽灵与落位一致，避免瞬移
    this.grabPx = Math.min(Math.max(x - r.left, 0), r.width);
    this.grabPy = Math.min(Math.max(y - r.top, 0), r.height);
    this.w = r.width; this.h = r.height;

    // 幽灵：整行克隆（.drag-ghost 提供绿色实线描边）
    const ghost = this.sourceEl.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.style.width = `${r.width}px`;
    ghost.style.height = `${r.height}px`;
    document.body.appendChild(ghost);
    this.ghost = ghost;

    // 源行移出网格流（display:none），其它队伍实时重排
    this.sourceEl.style.display = 'none';

    // 目标落位：空白块 + 绿色虚线描边；作为网格项插入，自动把其它队伍挤开
    const ph = document.createElement('div');
    ph.className = 'team-row-placeholder';
    document.getElementById('teamSection').appendChild(ph);
    this.placeholder = ph;

    this._positionGhost(x, y);
    this._updatePlaceholder(x, y);
    if (this.isTouch) window.addEventListener('touchmove', this._noScrollB, { passive: false });
  },

  _positionGhost(cx, cy) {
    if (!this.ghost) return;
    this.ghost.style.left = `${cx - this.grabPx}px`;
    this.ghost.style.top = `${cy - this.grabPy}px`;
  },

  // 计算目标落位下标：最近列 + 最近行 → 列优先线性下标
  _computeTarget(cx, cy) {
    const section = document.getElementById('teamSection');
    const cs = getComputedStyle(section);
    const r = section.getBoundingClientRect();
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padT = parseFloat(cs.paddingTop) || 0;
    const colGap = parseFloat(cs.columnGap) || 0;
    const rowGap = parseFloat(cs.rowGap) || 0;
    const cols = cs.gridTemplateColumns.split(' ').filter(Boolean).map(parseFloat);
    const rows = cs.gridTemplateRows.split(' ').filter(Boolean).map(parseFloat);
    const numCols = Math.max(1, cols.length);
    const colW = cols[0] || this.w;
    const perCol = Math.max(1, rows.length);   // 每列行数（由 updateLayoutScale 写入）
    const rowH = rows[0] || this.h;
    const n = teams.length;

    // 各列容量：末列可能未填满（列优先填充）
    const cap = [];
    for (let c = 0; c < numCols; c++) {
      cap[c] = (c < numCols - 1) ? perCol : Math.max(0, n - (numCols - 1) * perCol);
    }
    // 选择水平方向最近、且仍有容量的列
    // justify-content:center（单列收窄后居中）时所有列整体右移，落位计算要补上这段偏移
    const tracksW = cols.reduce((a, b) => a + b, 0) + (numCols - 1) * colGap;
    const hFree = section.clientWidth - padL - (parseFloat(cs.paddingRight) || 0) - tracksW;
    const hOff = (cs.justifyContent === 'center' && hFree > 0) ? hFree / 2 : 0;
    let col = 0, best = Infinity;
    for (let c = 0; c < numCols; c++) {
      if (cap[c] <= 0) continue;
      const centerX = r.left + padL + hOff + c * (colW + colGap) + colW / 2;
      const d = Math.abs(cx - centerX);
      if (d < best) { best = d; col = c; }
    }
    // 行：按行高+行距取最近行，再按该列容量钳制
    // alignContent:center 时网格内容整体下移，落位计算要补上这段偏移
    const contentH = rowH * rows.length + rowGap * Math.max(0, rows.length - 1);
    const free = section.clientHeight - padT - (parseFloat(cs.paddingBottom) || 0) - contentH;
    const vOff = (cs.alignContent === 'center' && free > 0) ? free / 2 : 0;
    let row = Math.round((cy - (r.top + padT + vOff + rowH / 2)) / (rowH + rowGap));
    row = Math.min(Math.max(row, 0), Math.max(0, cap[col] - 1));

    return Math.min(Math.max(col * perCol + row, 0), n - 1);
  },

  _updatePlaceholder(cx, cy) {
    if (!this.placeholder) return;
    const index = this._computeTarget(cx, cy);
    this.targetIndex = index;
    // 插入到当前第 index 个队伍之前 → 网格中占据该单元，其后队伍整体后移
    const section = document.getElementById('teamSection');
    const rows = Array.from(section.querySelectorAll('.team-row')).filter(el => el !== this.sourceEl);
    section.insertBefore(this.placeholder, rows[index] || null);
  },

  _noScroll(e) { e.preventDefault(); },

  _end(e) {
    if (e.pointerId !== this.pid) return;
    const wasActivated = this.activated;
    const from = this.teamIndex, to = this.targetIndex;
    this._cleanup();
    if (!wasActivated) return;
    if (to != null && from != null && to !== from && from < teams.length && to < teams.length) {
      const moved = teams[from];
      teams.splice(from, 1);
      teams.splice(to, 0, moved);
      saveData(); renderTeamPage();
    }
  },

  _cancel() { this._cleanup(); },

  _cleanup() {
    window.removeEventListener('pointermove', this._moveB);
    window.removeEventListener('pointerup', this._endB);
    window.removeEventListener('pointercancel', this._endB);
    if (this.isTouch) window.removeEventListener('touchmove', this._noScrollB, { passive: false });
    if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = null; }
    document.body.classList.remove('pointer-dragging');
    if (this.sourceEl) this.sourceEl.style.display = '';
    if (this.ghost) { this.ghost.remove(); this.ghost = null; }
    if (this.placeholder) { this.placeholder.remove(); this.placeholder = null; }
    this.pid = null; this.teamIndex = null; this.targetIndex = null;
  }
};

function setupTeamDrag(handleEl, teamIndex, rowEl) {
  handleEl.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    TeamDrag.begin(e, teamIndex, rowEl, e.pointerType !== 'mouse');
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
    setupTeamDrag(handle, teamIndex, row);

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

// ===== 页面3 计分 =====
// 每轮 5 个 BOSS 的「满血基础分」。第 5 列「矩阵奇藏」自身基础分就更高（见下表），与击杀奖励无关。
// 前 3 轮前 4 个 BOSS 数值相同；第 4、5 轮前 4 个 BOSS 差异细微，按其平均值计（约定）。
// 分数只作大致示意，最终显示按 SCORE_UNIT 取整。
const BOSS_ROUND_SCORES = [
  [4680.8, 4680.8, 4680.8, 4680.8, 5667.5],      // R1
  [9159.9, 9159.9, 9159.9, 9159.9, 13457.7],     // R2
  [20222.7, 20222.7, 20222.7, 20222.7, 22239.1], // R3
  [22750.5, 22750.5, 22750.5, 22750.5, 27798.9], // R4（前 4 个取平均）
  [27806.2, 27806.2, 27806.2, 27806.2, 33358.7], // R5（前 4 个取平均）
];
const BOSS_COLS = 5;            // 每条轨道等分为 5 个 BOSS 列
const SCORE_UNIT = 50;          // 显示取整单位（分数只需大致示意）
const BOSS5_KILL_BONUS = 1000;  // 击杀「矩阵奇藏」的额外分（每轮 1 个，与自身基础分相互独立）

// 某轮某 BOSS 列的满血分数（超出已知轮次时沿用最后一轮）。
// 第 5 列「矩阵奇藏」= 自身基础分 + 击杀奖励，两个机制独立；奖励同样沿血条线性平摊到整条血条。
function bossColScore(rIndex, col) {
  const row = BOSS_ROUND_SCORES[Math.min(rIndex, BOSS_ROUND_SCORES.length - 1)];
  return row[col] + (col === BOSS_COLS - 1 ? BOSS5_KILL_BONUS : 0);
}

// 单个队伍块在某轮的分数 = 覆盖各 BOSS 列的比例 × 该列分数。
// 分数沿血条线性分布，因此跨列（含跨第 4、5 个 BOSS 的边界）时按重叠比例自然叠加。
function bossBlockScore(rIndex, p) {
  const colW = 1 / BOSS_COLS;
  let sum = 0;
  for (let c = 0; c < BOSS_COLS; c++) {
    const ov = Math.min(p.x + p.w, (c + 1) * colW) - Math.max(p.x, c * colW);
    if (ov > 0) sum += (ov / colW) * bossColScore(rIndex, c);
  }
  return sum;
}

// 「自动续接占位」：R 轮最右端有队伍 a1，R+1 轮最左端为空、且最左队伍 b 的左缘仍在
// 第 1 个 BOSS 范围内时，[0, b.x) 这段空隙视为 a1 从上一轮延续下来的输出
// （可能小到放不下任何队伍块，但在高轮次里分数不小）。
// 返回 { teamId, w, off }；off 表示用户已把它点成「不生效」。纯派生，不写入 rounds。
function autoContinuation(roundIdx) {
  const rounds = (bossPage && bossPage.rounds) || [];
  if (roundIdx <= 0) return null;
  const prev = rounds[roundIdx - 1];
  const round = rounds[roundIdx];
  if (!prev || !round || !round.length) return null; // R+1 轮还没有队伍 b → 不出现
  let a1 = null; // 取最靠右的那个贴边块作为续接来源
  prev.forEach(p => { if (isEdgeRight(p) && (!a1 || p.x + p.w > a1.x + a1.w)) a1 = p; });
  if (!a1) return null;
  if (!getTeamById(a1.teamId)) return null; // 来源队伍已被删除 → 不派生占位
  if (round.some(p => p.teamId === a1.teamId)) return null; // 该队本轮已有实体块
  const leftmost = round.reduce((m, p) => Math.min(m, p.x), 1);
  if (leftmost <= 1e-6) return null;                   // b 已贴到最左端：不存在可供续接的间隙
  if (leftmost > 1 / BOSS_COLS + 1e-9) return null;    // b 的左缘已超出第 1 个 BOSS 范围
  const off = ((bossPage.autoOff) || []).indexOf(roundIdx) >= 0;
  return { teamId: a1.teamId, w: leftmost, off };
}

// 自动续接占位小于此宽度时不绘制（仍照常计分）：细到难以辨识，改由 🔗 链接符号表达其存在
const AUTO_MIN_RENDER = 0.01;

// 切换某轮自动续接占位的「生效 / 不生效」
function toggleAutoContinuation(roundIdx) {
  const offs = (bossPage.autoOff = bossPage.autoOff || []);
  const i = offs.indexOf(roundIdx);
  if (i >= 0) offs.splice(i, 1); else offs.push(roundIdx);
  saveData();
  renderBossPage();
}

// 构建「自动续接占位」块：无头像、不可拖动/拉伸/删除，宽度由最左队伍 b 的位置决定。
// 灰色虚线描边（粗=生效 / 细=不生效），点击切换是否计入分数；过窄时返回 null（不绘制）
function buildAutoPlaceholder(auto, roundIdx) {
  if (auto.w < AUTO_MIN_RENDER) return null;
  const el = document.createElement('div');
  el.className = 'placement placement-auto';
  if (auto.off) el.classList.add('placement-auto-off');
  el.dataset.teamId = auto.teamId;
  el.dataset.autoRound = roundIdx;
  el.style.left = '0%';
  el.style.width = `${auto.w * 100}%`;
  el.title = auto.off
    ? '自动续接占位（当前不生效，点击启用）'
    : '自动续接占位（当前生效，点击停用）';

  const score = document.createElement('div');
  score.className = 'placement-score';
  score.textContent = bossTeamScore(auto.teamId);
  el.appendChild(score);

  el.addEventListener('pointerdown', (e) => e.stopPropagation()); // 不触发轨道拖拽/落位
  el.addEventListener('click', (e) => { e.stopPropagation(); toggleAutoContinuation(roundIdx); });
  return el;
}

// 续接链接 i−1 ↔ i：来源为「实体续接块」或「自动占位块」。返回 { enabled, auto } 或 null。
// auto=true 表示链接由自动占位块产生（可点击切换启停）；实体续接块恒为 enabled
function linkIncoming(roundIdx) {
  const rounds = (bossPage && bossPage.rounds) || [];
  const round = rounds[roundIdx];
  if (!round || roundIdx <= 0) return null;
  const prev = rounds[roundIdx - 1] || [];
  const contBlock = round.find(p => p.cont);
  if (contBlock && prev.some(q => q.teamId === contBlock.teamId && isEdgeRight(q))) {
    return { enabled: true, auto: false };
  }
  const auto = autoContinuation(roundIdx);
  if (auto) return { enabled: !auto.off, auto: true };
  return null;
}

// 链接符号 ∝：in = 本轮轮次标签下方（左端）；out = 上一轮右侧（✕ 按钮所在的留白区）
function buildLinkBadge(roundIdx, kind, link) {
  const b = document.createElement('span');
  b.className = `track-link track-link-${kind}` + (link.enabled ? '' : ' track-link-off');
  b.textContent = '∝';   // 利用 color 着色：生效绿色 / 停用灰色（emoji 无法着色）
  if (link.auto) {
    b.classList.add('track-link-clickable');
    b.title = link.enabled ? '续接：与相邻轮次相连（点击停用）' : '续接：与相邻轮次相连（已停用，点击启用）';
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => { e.stopPropagation(); toggleAutoContinuation(roundIdx); });
  } else {
    b.title = '续接：与相邻轮次相连';
  }
  return b;
}

// 同步第 roundIdx 轮的链接符号：本轮 rail 下方 + 上一轮右侧各一个
function syncRoundLinks(roundIdx) {
  const tracks = document.querySelectorAll('#bossTracks .boss-track');
  const link = linkIncoming(roundIdx);
  const cur = tracks[roundIdx];
  if (cur) {
    const rail = cur.querySelector('.track-rail');
    rail.querySelectorAll(':scope > .track-link-in').forEach(n => n.remove());
    if (link) rail.appendChild(buildLinkBadge(roundIdx, 'in', link));
  }
  const prev = tracks[roundIdx - 1];
  if (prev) {
    prev.querySelectorAll(':scope > .track-link-out').forEach(n => n.remove());
    if (link) prev.appendChild(buildLinkBadge(roundIdx, 'out', link));
  }
}

// 与 autoContinuation 结果保持一致：重建该轮占位块，并同步相邻的链接符号
function syncAutoPlaceholder(roundIdx) {
  const grid = document.querySelectorAll('#bossTracks .track-grid')[roundIdx];
  if (grid) {
    grid.querySelectorAll(':scope > .placement-auto').forEach(n => n.remove());
    const auto = autoContinuation(roundIdx);
    if (auto) {
      const el = buildAutoPlaceholder(auto, roundIdx);
      if (el) grid.appendChild(el);
    }
  }
  syncRoundLinks(roundIdx);
}

// 同一队伍跨轮次出现 → 各块分数相加；该队伍的所有队伍块显示同一个合计值
function bossTeamScore(teamId) {
  const rounds = (bossPage && bossPage.rounds) || [];
  let total = 0;
  rounds.forEach((round, rIndex) => {
    round.forEach(p => { if (p.teamId === teamId) total += bossBlockScore(rIndex, p); });
    // 生效中的自动续接占位同样计入（该队伍本轮可能没有实体块）
    const auto = autoContinuation(rIndex);
    if (auto && !auto.off && auto.teamId === teamId) total += bossBlockScore(rIndex, { x: 0, w: auto.w });
  });
  return Math.round(total / SCORE_UNIT) * SCORE_UNIT;
}

// 刷新该队伍在全部轮次中所有队伍块的分数显示（缩放、落位后调用）
function refreshTeamScore(teamId) {
  const v = bossTeamScore(teamId);
  document.querySelectorAll('#bossTracks .placement').forEach(el => {
    if (Number(el.dataset.teamId) !== teamId) return;
    const s = el.querySelector('.placement-score');
    if (s) s.textContent = v;
  });
  refreshTotalScore();
}

// 刷新与本轮及相邻轮相关的所有队伍的分数（缩放会同时波及左右两轮的续接占位块）
function refreshScoresAround(roundIdx) {
  const ids = new Set();
  for (let i = roundIdx - 1; i <= roundIdx + 1; i++) {
    const r = (bossPage && bossPage.rounds) ? bossPage.rounds[i] : null;
    if (r) r.forEach(p => ids.add(p.teamId));
  }
  ids.forEach(id => refreshTeamScore(id));
}

// 战斗总分数：各队伍分数之和。同一队伍跨轮次的续接块在界面上重复显示同一个队伍总分，
// 因此按队伍去重累加（而非逐个块累加），避免续接块被重复计入。
function bossTotalScore() {
  let total = 0;
  (teams || []).forEach(t => { total += bossTeamScore(t.id); });
  return total;
}

function refreshTotalScore() {
  const el = document.getElementById('totalScore');
  if (el) el.textContent = `总分数：${bossTotalScore()}`;
}

// ===== 队伍使用限制 =====
// 每个队伍只能使用 1 次：已在右面板出现过的队伍，左面板中变暗且不可再拖出，直到右面板释放。
// 唯一例外（「续接」）：该队在第 r 轮紧贴最右端，且第 r+1 轮最左端无队伍
//   → 允许把该队再放到第 r+1 轮的最左端，表示它从上一轮末尾继续打下一轮。
const EDGE_TOL = 0.02;   // 判断「紧贴轨道左/右端」的容差（占轨道宽度的比例）

const isEdgeRight = p => p.x + p.w >= 1 - EDGE_TOL;

// 该队伍已出现在哪些轮次
function teamUsedRounds(teamId) {
  const out = [];
  ((bossPage && bossPage.rounds) || []).forEach((round, r) => {
    if (round.some(p => p.teamId === teamId)) out.push(r);
  });
  return out;
}

// 例外允许落位的轮次下标；无例外返回 -1
function teamReuseRound(teamId) {
  const rounds = (bossPage && bossPage.rounds) || [];
  for (let r = 0; r < rounds.length - 1; r++) {
    if (!rounds[r].some(p => p.teamId === teamId && isEdgeRight(p))) continue;
    const next = rounds[r + 1];
    if (next.some(p => p.teamId === teamId)) continue;   // 该轮已有此队，不重复放置
    if (next.some(p => p.x <= EDGE_TOL)) continue;       // 该轮最左端已有队伍
    return r + 1;
  }
  return -1;
}

// 是否为「续接」块（a2/a3…）：经例外拖出时打上的 cont 标记。
// 这类块被钉在本轮最左端，不可整体拖动，只能靠右侧把手向右拉伸。
function isContinuationBlock(p) { return !!p.cont; }

// 续接链完整性：续接块必须由上一轮同队「紧贴最右端」的块支撑。
// 支撑失效（前驱被删除 / 缩短后不再触底 / 前驱自身也已失效）时，级联删除后续续接块。
// 按轮次升序处理，故前驱被删后，后一轮能立即感知到，形成 a1→a2→a3 的连锁清理。
function pruneContinuations() {
  const rounds = (bossPage && bossPage.rounds) || [];
  const validIds = new Set(teams.map(t => t.id));
  let removed = 0;
  for (let r = 1; r < rounds.length; r++) {
    const prev = rounds[r - 1];
    const round = rounds[r];
    for (let i = round.length - 1; i >= 0; i--) {
      const p = round[i];
      if (!p.cont) continue; // 普通块（含自由移动到最左端的块）不参与清理
      if (!validIds.has(p.teamId)) continue; // 队伍已失效的块保留，由页面3 标示后交给用户处理
      if (prev.some(q => q.teamId === p.teamId && isEdgeRight(q))) continue; // 支撑仍在
      round.splice(i, 1);
      removed++;
    }
  }
  return removed;
}

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

// 求不与同轨道其它块重叠、且离目标位置最近的落位；无处可放返回 {x, w} / null。
// allowShrink=true 时支持“软落位”：间隔宽度 ≥ BOSS_MIN_W 即可放入，不足原宽度 w 时自动收缩到该间隔宽度
function bossFreeX(round, x, w, excludeIndex, allowShrink) {
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
    const gw = g.e - g.s;
    if (gw < BOSS_MIN_W - 1e-9) return;
    const w2 = allowShrink ? Math.min(w, gw) : w;   // 间隔不足原宽 → 收缩到间隔宽度
    if (gw < w2 - 1e-9) return;
    const cand = Math.max(g.s, Math.min(g.e - w2, x));
    const cost = Math.abs(cand - x);
    if (cost < bestCost) { bestCost = cost; best = { x: cand, w: w2 }; }
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

// 轨道内块与上下边缘的留白（与 styles.css 的 --track-inset-top/--track-inset-bottom 同源，
// 保证幽灵尺寸/位置与落位一致）。上方留白额外含“分数显示区”，故大于下方留白。
function trackInsetTop(grid) {
  const v = parseFloat(getComputedStyle(grid).getPropertyValue('--track-inset-top'));
  return Number.isFinite(v) ? v : 22;
}
function trackInsetBottom(grid) {
  const v = parseFloat(getComputedStyle(grid).getPropertyValue('--track-inset-bottom'));
  return Number.isFinite(v) ? v : 7;
}

function defaultBossPage() {
  // autoOff：被用户点成「不生效」的自动续接占位所在轮次下标集合
  return { bossNames: BOSS_DEF_NAMES.slice(), rounds: [[]], autoOff: [] };
}

// 规范化：补齐 5 个 BOSS 名、钳制 x/w（兼容旧的 col/span 格式）。
// 失效的队伍引用一律保留，不在加载时删除 —— 删除动作只由用户在界面上的 ✕ 触发。
function normalizeBossPage(bp) {
  const def = defaultBossPage();
  if (!bp) return def;
  const names = (Array.isArray(bp.bossNames) && bp.bossNames.length === 5)
    ? bp.bossNames.slice() : def.bossNames.slice();
  // 旧的占位名（BOSS-1…BOSS-5）迁移为新的默认名
  names.forEach((n, i) => { if (!n || n === `BOSS-${i + 1}`) names[i] = BOSS_DEF_NAMES[i]; });
  let rounds = (Array.isArray(bp.rounds) && bp.rounds.length) ? bp.rounds : [[]];
  // 队伍已被删除的块【不】在这里丢弃：原样保留，由页面3 用「队伍已失效」标示，
  // 让用户自己决定移除。避免一次加载就把整份排布永久抹掉。
  rounds = rounds.map(r => (Array.isArray(r) ? r : []).filter(p => p)
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
      const rec = { teamId: p.teamId, x: r4(x), w: r4(w) };
      if (p.cont) rec.cont = true; // 保留「续接块」标记
      return rec;
    }));
  if (!rounds.length) rounds = [[]];
  // 消除重叠：按左端升序依次安置，重叠的推到最近的可放位置（兼容旧版允许重叠的数据）
  rounds = rounds.map(r => {
    const out = [];
    r.slice().sort((a, b) => a.x - b.x).forEach(p => {
      const fit = bossFreeX(out, p.x, p.w, -1);
      const rec = { teamId: p.teamId, x: r4(fit ? fit.x : p.x), w: p.w };
      if (p.cont) rec.cont = true; // 保留「续接块」标记
      out.push(rec);
    });
    return out;
  });
  // 自动续接占位的「不生效」轮次：只保留仍存在的轮次下标
  const autoOff = Array.isArray(bp.autoOff)
    ? bp.autoOff.filter(n => Number.isInteger(n) && n > 0 && n < rounds.length)
    : [];
  return { bossNames: names, rounds, autoOff };
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

      const char = characters.find(c => c.name === slot.name);
      if (char && showAttr) {
        const attr = document.createElement('div');
        attr.className = 'attr';
        attr.textContent = `${char.chain}+${char.weapon}`;
        cell.appendChild(attr);
      }
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
    refreshTotalScore(); // 无用户 → 总分数归零
    return;
  }
  renderBossTeamList();
  renderBossHeader();
  renderBossTracks();
  updateBossLayout();
  refreshTotalScore();
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
    // 已使用（右面板已出现）且不满足「续接」例外 → 变暗、不可拖出
    if (teamUsedRounds(team.id).length && teamReuseRound(team.id) < 0) {
      block.classList.add('team-disabled');
    } else {
      setupBossDrag(block, 'new-team', { teamId: team.id });
    }
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

    // 竖排轮次标题：放轨道最左侧，不占用轨道高度
    const rail = document.createElement('div');
    rail.className = 'track-rail';
    const label = document.createElement('span');
    label.className = 'track-label';
    label.textContent = `第${rIndex + 1}轮`;
    rail.appendChild(label);
    track.appendChild(rail);

    const grid = document.createElement('div');
    grid.className = 'track-grid';
    track.appendChild(grid);

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
      track.appendChild(del);
    }
    round.forEach((p, pIndex) => {
      // 队伍已被删除 → 不丢弃块：渲染为占位并明确标示「队伍已失效」，由用户决定是否移除
      const team = getTeamById(p.teamId);
      const orphan = !team;
      // 「续接」块（a2/a3…）：钉在本轮最左端，不可整体移动、无左手柄，只能靠右手柄向右拉伸
      const cont = isContinuationBlock(p);
      const el = buildTeamBlock(orphan ? { slots: [null, null, null] } : team);
      el.classList.add('placement');
      if (orphan) el.classList.add('placement-orphan');
      if (cont) el.classList.add('placement-locked');
      el.dataset.teamId = p.teamId;
      el.style.left = `${p.x * 100}%`;
      el.style.width = `${p.w * 100}%`;

      // 分数：显示在块上方居中的预留空间内（算法见 bossTeamScore）
      const score = document.createElement('div');
      score.className = 'placement-score';
      score.textContent = orphan ? '—' : bossTeamScore(p.teamId);
      el.appendChild(score);

      if (orphan) {
        const tag = document.createElement('div');
        tag.className = 'orphan-tag';
        tag.textContent = '队伍已失效';
        el.title = `该块引用的队伍（id ${p.teamId}）在页面2 已被删除，排布数据已保留。可拖动调整位置，点 ✕ 移除。`;
        el.appendChild(tag);
      }

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
      // 续接块固定在左端，只有右手柄（无左手柄）
      if (!cont) {
        const rzL = document.createElement('div');
        rzL.className = 'placement-resize placement-resize-left';
        rzL.title = '拖动调整左边界';
        rzL.addEventListener('pointerdown', (e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          e.stopPropagation();
          BossDrag.beginResize(e, rIndex, pIndex, 'left');
        });
        el.appendChild(rzL);
      }

      const rzR = document.createElement('div');
      rzR.className = 'placement-resize placement-resize-right';
      rzR.title = '拖动调整右边界';
      rzR.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.stopPropagation();
        BossDrag.beginResize(e, rIndex, pIndex, 'right');
      });
      el.appendChild(rzR);

      // 续接块不可整体移动（钉在左端），只能靠右手柄拉伸
      if (!cont) setupBossDrag(el, 'move', { round: rIndex, index: pIndex });
      grid.appendChild(el);
    });
    // 自动续接占位：R 轮贴边队伍的续接输出，补齐 R+1 轮最左端放不下队伍块的空隙
    const auto = autoContinuation(rIndex);
    if (auto) {
      const ph = buildAutoPlaceholder(auto, rIndex);
      if (ph) grid.appendChild(ph);
    }
    // 续接链接符号：本轮标签下方（指向 R−1↔R）+ 上一轮右侧（指向 R↔R+1）
    const linkIn = linkIncoming(rIndex);
    if (linkIn) rail.appendChild(buildLinkBadge(rIndex, 'in', linkIn));
    const linkOut = linkIncoming(rIndex + 1);
    if (linkOut) track.appendChild(buildLinkBadge(rIndex + 1, 'out', linkOut));
    tracks.appendChild(track);
  });
}

// 读取页面3 尺寸常量：styles.css 的 #bossPage 块是唯一来源，JS 只读不写，避免与 CSS 双份维护
function bossLayoutConst(page) {
  const cs = getComputedStyle(page);
  const px = (name, fb) => {
    const v = parseFloat(cs.getPropertyValue(name));
    return Number.isFinite(v) ? v : fb;
  };
  return {
    panelPad: px('--bp-panel-pad', 20),
    tracksPadY: px('--bp-tracks-pad-y', 10),
    trackGap: px('--bp-track-gap', 10),
    trackChrome: px('--bp-track-pad-top', 4) + px('--bp-track-pad-bottom', 6) + px('--bp-track-border', 1) * 2,
    trackMinH: px('--bp-track-min-h', 52),
    designRounds: px('--bp-design-rounds', 3),
    blockPad: px('--bp-block-pad', 4),
    blockBorder: px('--bp-block-border', 1),
    slotGap: px('--bp-slot-gap', 4),
    scoreSpace: px('--bp-score-space', 15),   // 关闭“显示分数”时 CSS 侧已归零
    insetBottom: px('--bp-inset-bottom', 7),  // 竖屏时 CSS 侧已改为 0
    slotMin: px('--bp-slot-min', 18),
    teamPad: px('--bp-team-pad', 6),
    teamBorder: px('--bp-team-border', 1),
    teamMinSlot: px('--bp-team-min-slot', 34),
    teamSlotMax: px('--bp-team-slot-max', 72),
    teamGutter: px('--bp-team-gutter', 56),
    listGap: px('--bp-list-gap', 8),
    teamRows: px('--bp-team-rows', 4),
  };
}

// 把 CSS 里的 vh 长度（如 --bp-left-max-h: 34vh）换算为像素，避免在 JS 里重复写 0.34
function vhToPx(raw, fallback) {
  const m = /^\s*([\d.]+)vh\s*$/.exec(raw || '');
  return m ? window.innerHeight * parseFloat(m[1]) / 100 : fallback;
}

// 计算头像尺寸与轨道高度
function updateBossLayout() {
  const page = document.getElementById('bossPage');
  if (!page || page.classList.contains('hidden')) return;
  const grid = page.querySelector('#bossTracks .track-grid');
  const rightPanel = page.querySelector('.right-panel');
  const leftPanel = page.querySelector('.left-panel');
  if (!rightPanel || !leftPanel) return;
  const C = bossLayoutConst(page);
  const portrait = window.matchMedia('(orientation: portrait)').matches;
  // 块的外框（左右内边距 + 边框）与头像位间隔：头像初始尺寸 = 默认宽度下“1 个 BOSS 列宽 ÷ 3”再取 90%
  const blockFrame = 2 * (C.blockPad + C.blockBorder);
  const blockFrameWithGap = blockFrame + 2 * C.slotGap;
  // 上下留白：下方保持原边距（竖屏为 0）；上方额外加分数空间，供块上方的分数数字显示
  const insetBottom = C.insetBottom;
  const insetTop = insetBottom + C.scoreSpace;
  document.body.style.setProperty('--track-inset-top', `${insetTop}px`);
  document.body.style.setProperty('--track-inset-bottom', `${insetBottom}px`);

  // 轨道高度：桌面端由“每列宽 → 头像初始尺寸”推出；竖屏端行高由 CSS 均分，这里量取实际渲染值
  const colW = (grid ? grid.clientWidth : Math.max(0, rightPanel.clientWidth - 2 * C.panelPad)) / 5;
  const defaultWidthSlot = Math.max(C.slotMin, (colW - blockFrameWithGap) / 3 * 0.9);
  let trackH = defaultWidthSlot + 2 * insetBottom + blockFrame + C.scoreSpace;
  if (portrait) {
    // 竖屏行高由 styles.css 竖屏媒体查询的 grid-auto-rows 算好并已渲染完成，直接量取，
    // 不在 JS 里重复 CSS 的除法公式；无轨道（首次进入）时用同口径兜底
    const measured = grid ? grid.clientHeight : 0;
    if (measured > 0) {
      trackH = measured;
    } else {
      const tracksEl = document.getElementById('bossTracks');
      const avail = tracksEl ? tracksEl.clientHeight - 2 * C.tracksPadY : 0;
      const each = avail > 0
        ? (avail - C.trackGap * (C.designRounds - 1)) / C.designRounds - C.trackChrome
        : 0;
      trackH = Math.max(C.trackMinH, Math.floor(each));
    }
  }

  // 左面板：队伍条宽度只包住头像区，左右预留触屏滑动区（用于原生滚动，块上直接拖拽）
  const teamW = Math.max(0, leftPanel.clientWidth - 2 * C.panelPad);
  const teamFrame = 2 * (C.teamPad + C.teamBorder) + 2 * C.slotGap;
  const fitAll = (teamW - teamFrame) / 3;
  const afterGutter = (teamW - 2 * C.teamGutter - teamFrame) / 3;
  const widthSlot = Math.min(fitAll, Math.max(C.teamGutter, Math.min(C.teamSlotMax, afterGutter)));
  // 再按左面板可用高度收：按 --bp-team-rows 行预算，让半屏（移动端）能多浏览几支队伍
  const budgetH = portrait
    ? vhToPx(getComputedStyle(page).getPropertyValue('--bp-left-max-h'), window.innerHeight * 0.34)
    : leftPanel.clientHeight;
  const rowH = (budgetH - 2 * C.panelPad - C.listGap * (C.teamRows - 1)) / C.teamRows;
  const teamSlot = Math.max(C.teamMinSlot, Math.min(widthSlot, rowH - 2 * (C.teamPad + C.teamBorder)));
  // 头像位尺寸不再由脚本注入：styles.css 的 .placement .boss-slot 直接用
  // calc(--track-h − 上下留白 − 块内边距边框) 推出宽度上限，避免同一份算术写两遍
  document.body.style.setProperty('--track-h', `${trackH}px`);
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

// 拖回左面板时的高亮遮罩：用固定定位的独立元素绘制，确保绿色虚线/填充位于面板内队伍块与头像之上。
// 若直接给 .left-panel 加 background/outline，会被面板内子元素盖住，且滚动后会错位。
// panel 为 null 表示收起遮罩。
function setReleaseHoverOverlay(panel, on) {
  let ov = document.getElementById('releaseHoverOverlay');
  if (!on || !panel) {
    if (ov) ov.classList.remove('show');
    return;
  }
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'releaseHoverOverlay';
    document.body.appendChild(ov);
  }
  const r = panel.getBoundingClientRect();
  ov.style.left = `${r.left}px`;
  ov.style.top = `${r.top}px`;
  ov.style.width = `${r.width}px`;
  ov.style.height = `${r.height}px`;
  ov.classList.add('show');
}

const BossDrag = {
  pid: null, mode: null, source: null,
  sx: 0, sy: 0, activated: false, isTouch: false,
  holdTimer: null, ghost: null, sourceEl: null, resizeSide: null,
  grabPx: 0, grabPy: 0, ghostW: 0, ghostH: 0, gridW: 1,
  _moveB: null, _endB: null, _noScrollB: null, _resizeCtx: null, reuseRound: -1,

  beginMove(e, mode, source, isTouch) {
    this.pid = e.pointerId;
    this.mode = mode; this.source = source; this.isTouch = isTouch;
    this.sx = e.clientX; this.sy = e.clientY;
    this.activated = false; this.ghost = null;
    this.sourceEl = e.currentTarget;
    // 队伍已使用且无「续接」例外 → 不允许拖出（左面板对应块已变暗，此处兜底拦截）
    this.reuseRound = -1;
    if (mode === 'new-team' && teamUsedRounds(source.teamId).length) {
      const rr = teamReuseRound(source.teamId);
      if (rr < 0) { this.pid = null; this.source = null; this.sourceEl = null; return; }
      this.reuseRound = rr; // 例外：仅允许落到第 rr 轮的最左端
    }
    this._bind();
    // 触屏：长按 220ms 未滚动即启用拖拽，用于区分「滑动面板」与「拖动队伍」。
    // 左、右面板都需要：左面板队伍块两侧留白很窄，直接拖动极易误触，故同样要求长按
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
    this._lockScroll(); // 缩放立即生效，需立刻阻止页面滚动
  },

  _bind() {
    this._moveB = this._move.bind(this);
    this._endB = this._end.bind(this);
    this._noScrollB = this._noScroll.bind(this);
    window.addEventListener('pointermove', this._moveB);
    window.addEventListener('pointerup', this._endB);
    window.addEventListener('pointercancel', this._endB);
  },

  // 拖拽真正开始时才拦截 touchmove：激活之前不拦截，浏览器才能正常滚动面板
  _lockScroll() {
    if (this.isTouch) window.addEventListener('touchmove', this._noScrollB, { passive: false });
  },

  _move(e) {
    if (e.pointerId !== this.pid) return;
    if (this.mode === 'resize') { this._doResize(e.clientX); return; }
    const dx = e.clientX - this.sx, dy = e.clientY - this.sy;
    if (this.activated) { this._trackGhost(e.clientX, e.clientY); return; }
    if (this.holdTimer) {
      // 长按确认前若移动过大，判定为滑动面板，取消本次拖拽
      if (Math.hypot(dx, dy) > 10) { clearTimeout(this.holdTimer); this.holdTimer = null; this._cancel(); }
      return;
    }
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    this._activate(this.sx + dx, this.sy + dy);
  },

  _activate(x, y) {
    this.activated = true;
    this._lockScroll(); // 长按已确认是拖拽，此后阻止页面滚动
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
        gh = Math.max(0, gr.height - trackInsetTop(grid) - trackInsetBottom(grid));
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
    // 从左面板新建时，幽灵按落位后的块样式渲染（头像随块高缩放）；否则会沿用左面板的头像尺寸而撑出块外
    if (this.mode === 'new-team') {
      this.ghost.classList.remove('boss-team');
      this.ghost.classList.add('placement');
    }
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

  // 「续接」例外的新队伍：只接受落到例外轮次的轨道最左端，其余位置视为不可放置
  _reuseOk(roundIdx, fit) {
    if (this.mode !== 'new-team' || this.reuseRound < 0) return true;
    return !!fit && roundIdx === this.reuseRound && fit.x <= EDGE_TOL;
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
    if (leftPanel) setReleaseHoverOverlay(null, false);

    const grid = el && el.closest('.track-grid');
    if (!grid) {
      this._freeGhost(cx, cy);
      if (this.mode === 'move' && leftPanel && leftPanel.contains(el)) setReleaseHoverOverlay(leftPanel, true);
      return;
    }
    const rect = grid.getBoundingClientRect();
    const roundIdx = parseInt(grid.closest('.boss-track').dataset.round, 10);
    const round = bossPage.rounds[roundIdx];
    const info = round ? this._dragInfo(this.source, roundIdx) : null;
    const fit = info ? bossFreeX(round, (cx - rect.left) / rect.width - this.grabFrac, info.w, info.exclude, true) : null;
    if (!fit || !this._reuseOk(roundIdx, fit)) {
      grid.classList.add('drag-blocked'); // 放不下 / 例外落点不符：不吸附，仅跟随
      this._freeGhost(cx, cy);
    } else {
      grid.classList.add('drag-target');
      this.ghost.style.left = `${rect.left + fit.x * rect.width}px`;
      this.ghost.style.top = `${rect.top + trackInsetTop(grid)}px`;
      // 落位被收缩进窄间隔时，幽灵同步变窄以预告结果
      this.ghost.style.width = `${fit.w * rect.width}px`;
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
      const fit = bossFreeX(round, (clientX - rect.left) / rect.width - this.grabFrac, info.w, info.exclude, true);
      if (!fit || !this._reuseOk(roundIdx, fit)) return; // 无处可放 / 例外落点不符：保持原状
      if (this.mode === 'new-team') {
        const rec = { teamId: source.teamId, x: r4(fit.x), w: r4(fit.w) };
        if (this.reuseRound >= 0) rec.cont = true; // 经例外拖出 → 标记为续接块，供级联清理识别
        round.push(rec);
      } else {
        const srcRound = bossPage.rounds[source.round];
        const p = srcRound && srcRound[source.index];
        if (!p) return;
        srcRound.splice(source.index, 1);
        round.push({ teamId: p.teamId, x: r4(fit.x), w: r4(fit.w) });
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
    const wasX = p.x;                     // 左缘变化会影响本轮的自动续接占位宽度
    const wasEdgeRight = isEdgeRight(p); // 拉伸前是否贴住本轮最右端（决定「续接」例外是否成立）
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
    // 左缘变化 → 本轮自动续接占位宽度随之改变，实时同步
    if (p.x !== wasX) syncAutoPlaceholder(ctx.rIndex);
    // 「是否贴住最右端」翻转 → 该队「续接」例外成立与否随之改变：
    //   刷新左面板可用状态，并同步下一轮（可能新增/移除）的自动续接占位
    if (isEdgeRight(p) !== wasEdgeRight) {
      renderBossTeamList();
      syncAutoPlaceholder(ctx.rIndex + 1);
    }
    // 缩放波及本轮块的列跨度、本轮占位块（属上一轮贴边的 a 队）、下一轮占位块：
    // 必须逐队刷新，否则占位块的分不会实时并入 a 队（需刷新页面才更新）
    refreshScoresAround(ctx.rIndex);
  },

  _noScroll(e) { e.preventDefault(); },

  _end(e) {
    if (e.pointerId !== this.pid) return;
    const activated = this.activated;
    const mode = this.mode;
    const source = this.source;
    this._cleanup();
    if (!activated) return;
    if (mode === 'resize') {
      // 缩短后不再贴住本轮最右端 → 后续续接块失去支撑，级联删除并重渲染轨道
      const removed = pruneContinuations();
      saveData(); // 内部会再幂等清理一次并落盘
      if (removed) renderBossPage();
      return;
    }
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
    setReleaseHoverOverlay(null, false);
    this.pid = null; this.source = null; this._resizeCtx = null; this.resizeSide = null;
    // 注意：不要在此重置 reuseRound。_end 会先 _cleanup 再 _drop，
    // 若提前清空，松手时的 _reuseOk 会把「例外落点」误判为可放置。
    // 每次 beginMove 开头都会重新置 -1，无残留风险。
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

// 页面3“显示分数”开关（全局，跨刷新保留）
const savedGlobalShowScore = localStorage.getItem('globalShowScore');
if (savedGlobalShowScore !== null) showScore = savedGlobalShowScore === 'true';
const scoreToggleEl = document.getElementById('scoreToggle');
scoreToggleEl.checked = showScore;
// 应用开关：隐藏分数并收回为其预留的轨道空间（块高不变）
function applyScoreVisibility() {
  const page = document.getElementById('bossPage');
  if (page) page.classList.toggle('no-score', !showScore);
  updateBossLayout();
}
scoreToggleEl.addEventListener('change', function () {
  showScore = this.checked;
  localStorage.setItem('globalShowScore', showScore.toString());
  applyScoreVisibility();
});
applyScoreVisibility();

if (meta.currentUid != null) loadUser(meta.currentUid);
handleUrlHashImport();
renderUserList();
// 首屏显示上次激活的页面（默认角色页），并持久化
const prevPage = localStorage.getItem('activePage');
showPage(['role', 'team', 'boss'].includes(prevPage) ? prevPage : 'role');