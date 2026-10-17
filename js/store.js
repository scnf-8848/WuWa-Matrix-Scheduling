// ================= 运行态与持久化 =================
// 状态只有这一份（当前用户一份），页面渲染函数都读这里的变量，不再各自拷贝。
// 写入统一走 commit()：改数据 → 规范化 → 落盘 → 重绘，避免「内存改了界面没变」
// 或「界面变了刷新又回去」这类只差一步的问题。

// 运行态（当前用户一份）
let characters = [];
// 名字 → 角色对象：队伍块/占位块渲染时按名查找，避免每次 find 全表扫描。
// 每次 loadUser 重建；里面存的是同一批对象引用，所以改 chain/weapon/owned 无需重新索引。
let charByName = new Map();
let currentSelectedRoleIndex = null;
let teams = [];
let showAttr = true;
let showScore = true;   // 页面3 右面板：是否在队伍块上方显示分数（全局开关）
let extraUseChars = [];
// 页面3（BOSS 分配）：{ bossNames:[5个名称], rounds:[[{teamId,x,w}...],...] }
// x/w 为 0~1 连续比例：x=块左端占轨道宽度的比例，w=块宽度比例（宽度即该队打掉的血量占比）
// 初始为 null：loadUser 里由 normalizeBossPage 补成默认值（少一次默认值的双份定义）
let bossPage = null;
// 队伍 id 计数器：单调只增、随用户持久化。删除队伍后新队伍不再复用旧 id，
// 避免页面3 里引用旧 id 的块静默错绑到新队伍。
let teamIdSeq = 0;

// ================= 用户元数据 =================
// gameUsersMeta: { seq, currentUid, users:[{uid,name}] }
// userData_${uid}: { charData:{角色名:{owned,chain,weapon}}, teams, extraUseChars, bossPage, teamIdSeq }
// globalShowAttr: 'true'/'false'（跨用户）
const META_KEY = 'gameUsersMeta';
let meta = { seq: 0, currentUid: null, users: [] };

// meta 结构白名单：存储里的 meta 可能被写坏（多标签页并发写、手工改存储、旧版本 bug）。
// 而 meta.users.find / .length 一旦拿到 null 就直接抛 TypeError、初始化中断 → 三个页面全白、所有按钮无响应。
// 这里只保留形状合法的用户，并把 seq 抬到不小于任何已存在的 uid，避免新用户与旧号重复。
function loadMeta() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(META_KEY)); } catch { raw = null; }
  const def = { seq: 0, currentUid: null, users: [] };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { meta = def; return; }
  const seen = new Set();
  const users = [];
  (Array.isArray(raw.users) ? raw.users : []).forEach(u => {
    if (!u || typeof u !== 'object') return;
    if (!Number.isInteger(u.uid) || u.uid <= 0) return;
    if (seen.has(u.uid)) return;
    seen.add(u.uid);
    const name = (typeof u.name === 'string' && u.name.trim()) || `用户${u.uid}`;
    users.push({ uid: u.uid, name });
  });
  const maxUid = users.reduce((m, u) => Math.max(m, u.uid), 0);
  const seq = Math.max(Number(raw.seq) || 0, maxUid, 0);
  const currentUid = users.some(u => u.uid === raw.currentUid)
    ? raw.currentUid
    : (users.length ? users[0].uid : null);
  meta = { seq, currentUid, users };
}
function saveMeta() {
  writeStore(META_KEY, JSON.stringify({ seq: meta.seq, currentUid: meta.currentUid, users: meta.users }));
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
    data.teams = gsData.teams || defaultTeams();
    data.extraUseChars = gsData.extraUseChars || [];
    // 目标键已存在则不覆盖：绝不用旧版数据（无 bossPage、队伍无 id）抹掉已存在的数据
    if (localStorage.getItem(`userData_${i}`) == null) {
      writeStore(`userData_${i}`, JSON.stringify(data));
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
function defaultTeams() {
  return Array.from({ length: 3 }, () => ({ slots: [null, null, null] }));
}
// 队伍数组的不变量：至少 1 支、元素必须是对象。
// 注意空数组是 truthy，`d.teams || 默认` 挡不住 [] —— 之后 updateLayoutScale 会算出 perCol = 0，
// repeat(0, 78px) 是非法 CSS 被浏览器丢弃，队伍区停在上一状态或一片空白，且没有任何提示。
function normalizeTeams(raw) {
  const list = Array.isArray(raw) ? raw.filter(t => t && typeof t === 'object') : [];
  return list.length ? list : defaultTeams();
}
function loadUser(uid) {
  meta.currentUid = uid;
  saveMeta();
  const raw = localStorage.getItem(`userData_${uid}`);
  let d = null;
  if (raw) { try { d = JSON.parse(raw); } catch { d = null; } }
  if (d) {
    characters = characterTemplates.map(template => {
      const uc = (d.charData && d.charData[template.name]) || { owned: false, chain: 0, weapon: 0 };
      return { ...template, ...uc };
    });
    teams = normalizeTeams(d.teams);
    extraUseChars = d.extraUseChars || [];
    bossPage = d.bossPage || null;
  } else {
    characters = characterTemplates.map(template => ({
      ...template, owned: false, chain: 0, weapon: 0
    }));
    teams = defaultTeams();
    extraUseChars = [];
    bossPage = null;
  }
  charByName = new Map(characters.map(c => [c.name, c]));
  teams.forEach(t => { if (!Array.isArray(t.slots)) t.slots = [null, null, null]; });
  teamIdSeq = d ? (Number(d.teamIdSeq) || 0) : 0; // 恢复该用户的 id 计数器（旧数据无此字段 → 0）
  ensureTeamIds();
  bossPage = normalizeBossPage(bossPage); // 规整格式；失效的队伍引用保留，不在此处删除
  // 右侧详情面板只按「点击时传入的下标」绘制，换用户后下标会指向新用户的同序角色：
  // 看着上一个用户的链/武、点下去改的却是当前用户的数据。这里统一回到空态。
  currentSelectedRoleIndex = null;
  const detail = document.getElementById('roleDetail');
  if (detail) detail.innerHTML = '<p>请选择一个角色查看详情</p>';
}

// 状态不变量：所有交互改完数据后都走这里再落盘。
// 目前做两件事 —— 队伍槽位形状修正、队伍 id 补齐；续接链剪枝仍在 saveData 里（幂等）。
function normalizeState() {
  teams.forEach(t => { if (!Array.isArray(t.slots)) t.slots = [null, null, null]; });
  // 槽位里指向「角色模板中已不存在的名字」（改过名/被移除）的引用置空：
  // 否则页面2/3 会一直挂着一个角色池里没有的角色，用户无法用任何正常操作清掉。
  teams.forEach(t => {
    for (let i = 0; i < t.slots.length; i++) {
      const s = t.slots[i];
      if (s && (!s.name || !charByName.has(s.name))) t.slots[i] = null;
    }
  });
  ensureTeamIds();
}

function persistUserData() {
  if (meta.currentUid == null) return;
  const charData = {};
  characters.forEach(char => { charData[char.name] = { owned: char.owned, chain: char.chain, weapon: char.weapon }; });
  // 写入失败不抛出：界面照常响应，只提示一次「没存进去」，不让用户刷新后才发现丢数据
  writeStore(`userData_${meta.currentUid}`, JSON.stringify({ charData, teams, extraUseChars, bossPage, teamIdSeq }));
  saveMeta();
  writeStore('globalShowAttr', showAttr.toString());
}

// 落盘前的最后一道自检。pruneContinuations 幂等，重复调用无副作用。
function saveData() {
  if (meta.currentUid == null) return;
  pruneContinuations(); // 续接链失效的后续块一并清理，保证存盘、内存与界面三者一致
  persistUserData();
}

// 统一提交：改数据 → 规范化 → 落盘 → 重绘。
// 以前这套「改完数据必须做的三件事」散落在 20 多个事件处理器里，漏一步就是
// 「内存改了、界面没变」或「界面变了、刷新又回去」。现在只在这里写一次。
// render 不传时重绘当前页（大多数交互的目标）。
function commit(mutate, render) {
  if (typeof mutate === 'function') mutate();
  normalizeState();
  saveData();
  (typeof render === 'function' ? render : rerenderCurrentPage)();
}

// ================= 用户增删 =================
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
