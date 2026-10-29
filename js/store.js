// ================= 运行态与持久化 =================
// 状态只有这一份（当前用户一份），页面渲染函数都读这里的变量，不再各自拷贝。
// 写入统一走 commit()：改数据 → 规范化 → 落盘 → 重绘，避免「内存改了界面没变」
// 或「界面变了刷新又回去」这类只差一步的问题。
//
// 角色一律用 id 作外键（charData / 槽位 / 额外疲劳表都不用名字）：
// 名字是展示用的，改一个字的译名就会让持有状态与队伍槽位全部指向不存在的角色；
// id 由 characters.js 的「id 纪律」保证永不复用，且分享码本来就按 id 顺序编码。
// 旧数据（以名字为键）在 readUserData 里一次性迁移，见 migrateUserData。

const SCHEMA_VERSION = 3;
const CHAIN_MAX = 6;   // 共鸣链 0-6
const WEAPON_MAX = 5;  // 专武精炼 0-5
const TEMPLATE_BY_ID = new Map(characterTemplates.map(t => [t.id, t]));
const CHAR_ID_BY_NAME = new Map(characterTemplates.map(t => [t.name, t.id]));

// 运行态（当前用户一份）
let characters = [];
// id → 角色对象：队伍块/占位块/槽位渲染时按 id 查找，避免每次 find 全表扫描。
// 每次 loadUser 重建；里面存的是同一批对象引用，所以改 chain/weapon/owned 无需重新索引。
let charById = new Map();
let currentSelectedRoleIndex = null;
let teams = [];
let showAttr = true;
let showScore = true;   // 页面3 右面板：是否在队伍块上方显示分数（全局开关）
// 额外疲劳角色（id 集合）
let extraUseChars = new Set();
// 页面3（BOSS 分配）：{ bossNames:[5个名称], rounds:[[{teamId,x,w}...],...] }
// x/w 为 0~1 连续比例：x=块左端占轨道宽度的比例，w=块宽度比例（宽度即该队打掉的血量占比）
// 初始为 null：loadUser 里由 normalizeBossPage 补成默认值（少一次默认值的双份定义）
let bossPage = null;
// 队伍 id 计数器：单调只增、随用户持久化。删除队伍后新队伍不再复用旧 id，
// 避免页面3 里引用旧 id 的块静默错绑到新队伍。
let teamIdSeq = 0;
// 数据世代：换用户/整份导入时自增。keyed 渲染据此判断「节点还能不能复用」——
// 复用节点的前提是它绑定的对象没变，换用户后整批对象都是新的，必须强制重建。
let dataEpoch = 0;

const clampInt = (v, min, max, def) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

// ================= 用户元数据 =================
// gameUsersMeta: { seq, currentUid, users:[{uid,name}] }
// userData_${uid}: { v, charData:{[角色id]:{owned,chain,weapon}}, teams, extraUseChars:[id...], bossPage, teamIdSeq }
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
// 持有点数：当前用户读内存（与界面同源），其它用户读存储
function getCharCount(uid) {
  if (uid === meta.currentUid) return characters.filter(c => c.owned).length;
  const d = readUserData(uid);
  return d ? Object.values(d.charData).filter(v => v.owned).length : 0;
}
// 队伍数（只算槽位里真的站了人的队伍）：用户栏的副标题用。
// 与 getCharCount 一样，当前用户读内存、其余读存储 —— 两处口径必须一致，
// 否则刚改完队伍时侧栏数字会慢半拍。
function getTeamCount(uid) {
  const list = uid === meta.currentUid ? teams : (readUserData(uid) || {}).teams;
  return (Array.isArray(list) ? list : []).filter(t => t && Array.isArray(t.slots) && t.slots.some(s => s && s.id)).length;
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
function getCharById(id) { return charById.get(id); }

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

// ---- 旧格式迁移 ----
// 旧的 charData 以角色名为键；旧的槽位是 { name }。都在这里一次性换成 id。
function migrateSlot(s) {
  if (!s || typeof s !== 'object') return null;
  if (Number.isInteger(s.id)) return { id: s.id };
  const id = typeof s.name === 'string' ? CHAR_ID_BY_NAME.get(s.name) : null;
  return id == null ? null : { id };
}
function normalizeCharData(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  Object.keys(raw).forEach(k => {
    const id = /^\d+$/.test(k) ? Number(k) : CHAR_ID_BY_NAME.get(k);
    const v = raw[k];
    if (id == null || !TEMPLATE_BY_ID.has(id) || !v || typeof v !== 'object') return;
    // 只取这三个字段（白名单）：早前版本曾把整份模板写进 charData，
    // 直接展开会覆盖 id/totalUses（甚至 name），让查表与槽位解析错位。
    out[id] = {
      owned: !!v.owned,
      chain: clampInt(v.chain, 0, CHAIN_MAX, 0),
      weapon: clampInt(v.weapon, 0, WEAPON_MAX, 0),
    };
  });
  return out;
}
function normalizeExtraUse(raw) {
  const out = new Set();
  (Array.isArray(raw) ? raw : []).forEach(v => {
    const id = typeof v === 'number' ? v : CHAR_ID_BY_NAME.get(v);
    if (id != null && TEMPLATE_BY_ID.has(id)) out.add(id);
  });
  return out;
}
// 把一份存储数据规整成内存格式（纯函数：不写存储，读取失败的旧数据不会被覆盖）
function migrateUserData(d) {
  const teamsOut = normalizeTeams(d.teams);
  teamsOut.forEach(t => {
    if (!Array.isArray(t.slots)) t.slots = [null, null, null];
    t.slots = t.slots.map(migrateSlot);
  });
  return {
    charData: normalizeCharData(d.charData),
    teams: teamsOut,
    extraUseChars: normalizeExtraUse(d.extraUseChars),
    bossPage: d.bossPage || null,
    teamIdSeq: Number(d.teamIdSeq) || 0,
  };
}
// 读某个用户的数据（已迁移）；不存在/损坏/存储不可用都返回 null
function readUserData(uid) {
  let raw = null;
  try { raw = localStorage.getItem(`userData_${uid}`); } catch { return null; }
  if (!raw) return null;
  let d = null;
  try { d = JSON.parse(raw); } catch { return null; }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  return migrateUserData(d);
}

// 把「从存储读到的数据」装进内存并完成派生索引。不写存储、不改 meta ——
// 这样多标签页同步与 loadUser 可以共用同一段逻辑，而同步路径不会回写引发回声。
function applyUserData(uid) {
  const d = readUserData(uid);
  if (d) {
    characters = characterTemplates.map(t => {
      const uc = d.charData[t.id];
      return {
        ...t,
        owned: !!(uc && uc.owned),
        chain: uc ? uc.chain : 0,
        weapon: uc ? uc.weapon : 0,
      };
    });
    teams = d.teams;
    extraUseChars = d.extraUseChars;
    bossPage = normalizeBossPage(d.bossPage);
    teamIdSeq = d.teamIdSeq;
  } else {
    characters = characterTemplates.map(template => ({
      ...template, owned: false, chain: 0, weapon: 0
    }));
    teams = defaultTeams();
    extraUseChars = new Set();
    bossPage = normalizeBossPage(null);
    teamIdSeq = 0;
  }
  charById = new Map(characters.map(c => [c.id, c]));
  normalizeState(); // 进页面时就把脏数据（未持有占槽 / 已移除角色）清掉，不必等第一次点击
  // 右侧详情面板只按「点击时传入的下标」绘制，换用户后下标会指向新用户的同序角色：
  // 看着上一个用户的链/武、点下去改的却是当前用户的数据。这里统一回到空态。
  currentSelectedRoleIndex = null;
  const detail = document.getElementById('roleDetail');
  if (detail) detail.innerHTML = '<p>请选择一个角色查看详情</p>';
  dataEpoch++;
}

function loadUser(uid) {
  meta.currentUid = uid;
  saveMeta();
  applyUserData(uid);
}

// 状态不变量：所有交互改完数据后都走这里再落盘。
// 不变量有三类：队伍槽位形状/id 补齐；槽位里不得出现「未持有 / 模板中已不存在」的角色；
// 页面3 的块必须引用「还有角色的队伍」。
// 前两条曾散在 setCharOwned、「全部没有」、toggleExtraUse、importStateToUser 四处，
// 加第五条写入路径时极容易漏 —— 现在统一在这里兜底（import 路径显式复用同名纯函数，见下）。
function pruneInvalidSlots(list, isUsable) {
  (Array.isArray(list) ? list : []).forEach(t => {
    if (!t || !Array.isArray(t.slots)) return;
    for (let i = 0; i < t.slots.length; i++) {
      const s = t.slots[i];
      if (s && !isUsable(s.id)) t.slots[i] = null;
    }
  });
}

// 页面3 的块必须引用「还有角色的队伍」。
// 场景：把队伍拖上轨道后，回页面1 把该队角色逐个标为未持有 → 槽位被清空，队伍本身还在，
// 于是块照着队伍渲染：没有头像、分数 0，却仍占着轨道上的一段位置（还会把别的队伍挡在外面），
// 看上去就像一块渲染残骸。这种块没有任何意义，直接丢掉。
// 队伍被整个删除的块不在此列：那种情况要保留并渲染成「队伍已失效」占位，由用户决定去留
// （见 pruneContinuations 的同款判断）。
// 纯函数：只改传入的 page，返回删掉的块数。
function pruneEmptyTeamBlocks(page, list) {
  const rounds = page && Array.isArray(page.rounds) ? page.rounds : null;
  if (!rounds) return 0;
  const hasChar = new Map();
  (Array.isArray(list) ? list : []).forEach(t => {
    if (!t || t.id == null) return;
    hasChar.set(t.id, !!(Array.isArray(t.slots) && t.slots.some(s => s && s.id)));
  });
  let removed = 0;
  for (let r = 0; r < rounds.length; r++) {
    const round = rounds[r];
    if (!Array.isArray(round)) continue;
    const kept = round.filter(p => {
      const id = p && p.teamId;
      if (!hasChar.has(id)) return true; // 队伍不存在 → 保留为「队伍已失效」
      return hasChar.get(id);
    });
    if (kept.length !== round.length) {
      removed += round.length - kept.length;
      rounds[r] = kept;
    }
  }
  return removed;
}

function normalizeState() {
  teams.forEach(t => { if (!Array.isArray(t.slots)) t.slots = [null, null, null]; });
  // 没有角色时不做删除：否则「还没载入用户」的瞬间会把整份槽位清空
  if (characters.length) {
    pruneInvalidSlots(teams, id => {
      const c = charById.get(id);
      return !!(c && c.owned);
    });
  }
  ensureTeamIds();
  // 槽位清空后再判定页面3 的块：被清空的队伍已经没有可显示的内容
  pruneEmptyTeamBlocks(bossPage, teams);
  // 上一步可能删掉了某条续接链的支撑块，级联清理随之失效的后续块（幂等）
  pruneContinuations();
}

// 一份「可直接落盘」的数据快照：当前用户读内存（可能有还没落盘的改动），
// 其余用户读存储（它们没有内存态）。
// 落盘与「复制用户」共用这一个口径 —— 否则复制当前用户拿到的是上一次落盘的旧数据，
// 刚改的链/武/配队会整段丢掉。
// 注意 teams / bossPage 是直接引用：调用方要立刻 JSON.stringify，不能攒着等下次修改。
function snapshotUserData(uid) {
  if (uid === meta.currentUid) {
    const charData = {};
    characters.forEach(char => {
      charData[char.id] = { owned: !!char.owned, chain: char.chain, weapon: char.weapon };
    });
    return {
      v: SCHEMA_VERSION,
      charData,
      teams,
      extraUseChars: [...extraUseChars],
      bossPage,
      teamIdSeq,
    };
  }
  const d = readUserData(uid);
  if (!d) {
    // 从没落过盘的用户（新建后没做任何改动就切走，或存储被清过）：按默认空数据算，
    // 与 applyUserData 对「读不到数据」的处理保持一致 —— 否则「复制空用户」会变成失败
    return {
      v: SCHEMA_VERSION,
      charData: {},
      teams: defaultTeams(),
      extraUseChars: [],
      bossPage: normalizeBossPage(null),
      teamIdSeq: 0,
    };
  }
  return {
    v: SCHEMA_VERSION,
    charData: d.charData,
    teams: d.teams,
    extraUseChars: [...d.extraUseChars],
    bossPage: d.bossPage,
    teamIdSeq: d.teamIdSeq,
  };
}

function persistUserData() {
  if (meta.currentUid == null) return;
  // 写入失败不抛出：界面照常响应，只提示一次「没存进去」，不让用户刷新后才发现丢数据
  writeStore(`userData_${meta.currentUid}`, JSON.stringify(snapshotUserData(meta.currentUid)));
  saveMeta();
  writeStore('globalShowAttr', showAttr.toString());
}

// 落盘前的最后一道自检。pruneContinuations 幂等，重复调用无副作用。
function saveData() {
  if (meta.currentUid == null) return;
  pruneContinuations(); // 续接链失效的后续块一并清理，保证存盘、内存与界面三者一致
  persistUserData();
}

// ================= 分享码（数据层） =================
// 当前用户直接读内存：与界面同源。以前一律读 localStorage —— 写失败（隐私模式 / 配额满）时，
// 底部码条会停在上一次成功写入的值，屏幕上刚改的链/武没体现进去，用户会把旧码发出去。
// 其它用户（用户管理里导出、链接比对）仍读存储：它们没有内存态。
function encodeUserState(uid) {
  if (uid === meta.currentUid) return encodeCharStates(characters, extraUseChars);
  const d = readUserData(uid);
  const states = canonicalChars().map(t => {
    const uc = (d && d.charData[t.id]) || {};
    return { id: t.id, owned: !!uc.owned, chain: uc.chain || 0, weapon: uc.weapon || 0 };
  });
  return encodeCharStates(states, d ? d.extraUseChars : []);
}

// 把分享码写入指定用户的角色库（覆盖角色数据与额外疲劳，保留队伍与页面3 排布）
function importStateToUser(uid, code) {
  const res = decodeState(code);
  if (!res.ok) return res;
  const d = readUserData(uid)
    || { charData: {}, teams: defaultTeams(), extraUseChars: new Set(), bossPage: null, teamIdSeq: 0 };
  const canon = canonicalChars();
  const charData = {};
  canon.forEach((tpl, i) => {
    charData[tpl.id] = decodeValue(i < res.states.length ? res.states[i] : 0);
  });
  d.charData = charData;
  d.extraUseChars = new Set(res.extra.map(i => canon[i]).filter(Boolean).map(t => t.id));
  // 槽位里不能留下「新状态中未持有」的角色：否则页面2/3 仍会显示它（头像照画、分数照算），
  // 而角色池里已经没有它，用户无法用任何正常操作清掉。与 normalizeState 共用同一条规则。
  pruneInvalidSlots(d.teams, id => !!(charData[id] && charData[id].owned));
  // 同一份数据里的页面3 排布也要跟着收缩：队伍被清空的块不能再留着（见 pruneEmptyTeamBlocks）
  pruneEmptyTeamBlocks(d.bossPage, d.teams);
  if (!writeStore(`userData_${uid}`, JSON.stringify({
    v: SCHEMA_VERSION,
    charData: d.charData,
    teams: d.teams,
    extraUseChars: [...d.extraUseChars],
    bossPage: d.bossPage,
    teamIdSeq: d.teamIdSeq,
  }))) {
    return { ok: false, error: '写入失败：浏览器存储不可用或空间已满，本次导入未生效' };
  }
  return { ok: true };
}

// 统一提交：改数据 → 规范化 → 落盘 → 重绘。
// 以前这套「改完数据必须做的三件事」散落在 20 多个事件处理器里，漏一步就是
// 「内存改了、界面没变」或「界面变了、刷新又回去」。现在只在这里写一次。
// render 不传时重绘当前页（大多数交互的目标）；传 false 表示「DOM 已就地更新过、
// 且结构没变」，只做规范化与落盘（例如页面3 拉伸收尾：位置由拖拽过程写进样式）。
function commit(mutate, render) {
  if (typeof mutate === 'function') mutate();
  normalizeState();
  saveData();
  if (render === false) return;
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

// ================= 复制用户 =================
// 「原名_复制N」：N 取最小的未占用序号。
// 名字本身带 _复制N 时先剥掉 —— 否则「复制一份复制体」会得到 用户1_复制1_复制1，
// 序号一层层套下去越看越乱，而它本质仍是从 用户1 派生的第 N 份。
function copyUserName(name) {
  const base = name.replace(/_复制\d+$/, '') || name;
  const used = new Set(meta.users.map(u => u.name));
  let n = 1;
  while (used.has(`${base}_复制${n}`)) n++;
  return `${base}_复制${n}`;
}

// 复制用户：整份数据一起拷（角色库 + 队伍 + 额外疲劳 + 页面3 排布 + 队伍 id 计数器）。
// 队伍 id 原样保留、不重新编号：复制体是独立的命名空间，页面3 的块靠 teamId 引用
// 它自己的队伍，重编号还得把 bossPage 里的引用逐条改，反而多一处能错的地方。
// 不自动切到复制体（见调用方注释）。
function duplicateUser(uid, name) {
  const snap = snapshotUserData(uid);
  const newUid = addUser(name, false);
  // addUser 已经把用户挂进 meta.users 并落盘；这里写数据失败就把它撤掉，
  // 别在列表里留一个点进去空白的壳（seq 不回退：uid 只增不复用）
  if (!writeStore(`userData_${newUid}`, JSON.stringify(snap))) {
    meta.users = meta.users.filter(u => u.uid !== newUid);
    saveMeta();
    return null;
  }
  return newUid;
}

// ================= 文件备份：全部用户的导入 / 导出 =================
// 与分享码是两条完全不同的通道，别混：
//   分享码   —— 一个用户的角色库（持有 / 链 / 武 + 额外疲劳），十几位字符，发给别人传状态用；
//   文件备份 —— 本机全部用户的完整数据（含配队、页面3 排布），存成 json，换机器 / 换浏览器 / 归档用。
// 文件里带 uid，只为让「导出时停在哪个用户」能在导入后重新对上；导入时一律重新分配 uid
// （理由见 importBackup —— 直接沿用文件里的 uid 会静默覆盖目标浏览器里的同名用户）。
const BACKUP_APP = 'wuwa-matrix-scheduling';
const BACKUP_FORMAT = 1;

// 导出：把全部用户拼成一份可直接落成文件的快照。
// 当前用户读内存（含还没落盘的改动）、其余读存储 —— 与「复制用户」同一个口径。
function buildBackup() {
  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    schema: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    currentUid: meta.currentUid,
    users: meta.users.map(u => ({ uid: u.uid, name: u.name, data: snapshotUserData(u.uid) })),
  };
}

// 校验 + 清洗一份备份内容。纯函数、不写存储：先让用户看清「要导入几个用户」再决定覆盖还是合并。
function parseBackup(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '文件内容不是一个 JSON 对象' };
  }
  if (raw.app && raw.app !== BACKUP_APP) {
    return { ok: false, error: '这不是本站导出的备份文件' };
  }
  if (!Array.isArray(raw.users)) {
    return { ok: false, error: '文件里没有用户列表，可能不是本站导出的备份' };
  }
  const users = [];
  let skipped = 0;
  raw.users.forEach(u => {
    if (!u || typeof u !== 'object' || !u.data || typeof u.data !== 'object' || Array.isArray(u.data)) {
      skipped++;
      return;
    }
    const name = (typeof u.name === 'string' && u.name.trim()) || '未命名用户';
    users.push({ srcUid: Number(u.uid) || null, name, data: sanitizeUserData(u.data) });
  });
  if (!users.length) return { ok: false, error: '文件里没有可导入的用户数据' };
  return {
    ok: true,
    users,
    skipped,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : null,
    currentUid: Number(raw.currentUid) || null,
  };
}

// 导入前的清洗：走与「读取旧数据」同一条迁移路径（旧版以名字为键的数据也能导入），
// 再按当前的状态规则修剪 —— 槽位不能留未持有的角色、页面3 不能留空队伍的块、队伍 id 补齐。
// 不做这一步，一份手改过或来自旧版本的文件就会把脏数据写进存储，等下次打开才炸。
function sanitizeUserData(d) {
  const m = migrateUserData(d);
  pruneInvalidSlots(m.teams, id => !!(m.charData[id] && m.charData[id].owned));
  m.bossPage = normalizeBossPage(m.bossPage);
  pruneEmptyTeamBlocks(m.bossPage, m.teams);
  // seedTeamIdSeq 只看全局 teams / bossPage，这里要给「待导入的这一份」单独算一遍，
  // 否则新队伍的 id 会与文件里已有的队伍撞号，页面3 的块就错绑了
  let maxId = Number(m.teamIdSeq) || 0;
  const rounds = (m.bossPage && Array.isArray(m.bossPage.rounds)) ? m.bossPage.rounds : [];
  rounds.forEach(r => (Array.isArray(r) ? r : []).forEach(p => {
    if (p && typeof p.teamId === 'number' && p.teamId > maxId) maxId = p.teamId;
  }));
  m.teams.forEach(t => { if (typeof t.id === 'number' && t.id > maxId) maxId = t.id; });
  m.teams.forEach(t => { if (typeof t.id !== 'number') t.id = ++maxId; });
  m.teamIdSeq = maxId;
  return m;
}

// 落盘。mode：
//   'merge'   —— 保留现有用户，文件里的用户追加到末尾（重名自动加序号）
//   'replace' —— 用文件里的用户替换全部现有用户
// 两条路径的共同点：**导入的用户一律分配新 uid**。若沿用文件里的 uid，碰到「目标浏览器
// 已有一个 uid 相同的用户」就会把人家的数据直接覆盖掉 —— 而备份文件恰恰大多来自另一台机器 /
// 另一个浏览器。新旧 uid 的对应关系只用来还原「导出时停在哪个用户」。
// 失败（配额满 / 存储被禁用）必须能整笔回滚：先把新用户的键写完，全部成功才动旧数据。
function importBackup(parsed, mode) {
  if (!parsed || !parsed.ok) return { ok: false, error: '没有可导入的数据' };
  const prevUsers = meta.users.slice();
  const prevSeq = meta.seq;
  const prevCurrent = meta.currentUid;
  const written = [];

  const rollback = (error) => {
    written.forEach(uid => localStorage.removeItem(`userData_${uid}`));
    meta.users = prevUsers;
    meta.seq = prevSeq;
    meta.currentUid = prevCurrent;
    return { ok: false, error };
  };

  // 覆盖模式下旧用户马上就要被删掉，重名判断不该把它们算进来 ——
  // 否则「导出时叫甲，覆盖导入后叫甲 (4)」，明明是一次干净还原却平白多了后缀
  const usedNames = new Set(mode === 'replace' ? [] : prevUsers.map(u => u.name));
  const added = [];
  const uidOf = new Map();   // 文件里的 uid → 本次分配的 uid

  for (const u of parsed.users) {
    // 新 uid 要避开任何已存在的 userData_ 键（含历史遗留的孤儿键），与 addUser 同一条纪律
    let uid;
    do { meta.seq += 1; uid = meta.seq; } while (localStorage.getItem(`userData_${uid}`) != null);
    const name = uniqueName(u.name, usedNames);
    usedNames.add(name);
    const d = u.data;
    if (!writeStore(`userData_${uid}`, JSON.stringify({
      v: SCHEMA_VERSION,
      charData: d.charData,
      teams: d.teams,
      extraUseChars: [...d.extraUseChars],
      bossPage: d.bossPage,
      teamIdSeq: d.teamIdSeq,
    }))) {
      return rollback('写入失败：浏览器存储不可用或空间已满，本次导入未生效');
    }
    written.push(uid);
    added.push({ uid, name });
    if (u.srcUid != null && !uidOf.has(u.srcUid)) uidOf.set(u.srcUid, uid);
  }

  // 新数据全部写成功之后才动旧数据：覆盖模式在这一步删掉旧用户的键
  if (mode === 'replace') {
    prevUsers.forEach(u => localStorage.removeItem(`userData_${u.uid}`));
    meta.users = added;
    const target = parsed.currentUid != null ? uidOf.get(parsed.currentUid) : null;
    meta.currentUid = target != null ? target : added[0].uid;
  } else {
    meta.users = prevUsers.concat(added);
    // 合并时**不切用户**：用户手上正开着某份活，导入只是往列表里添几行。
    // 只有原本没有当前用户（理论上 ensureUser 兜住了，这里防御）才退到第一个。
    if (meta.currentUid == null || !meta.users.some(u => u.uid === meta.currentUid)) {
      meta.currentUid = added[0].uid;
    }
  }
  saveMeta();
  return { ok: true, added, replaced: mode === 'replace', skipped: parsed.skipped || 0 };
}

// 合并导入时重名会让侧栏出现两行一模一样的名字，加序号区分。
// 这里不用复制用户那套「_复制N」：导入体不是派生品，`(2)` 更中性，也不会与 _复制N 的编号打架。
function uniqueName(base, used) {
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}

// ================= 多标签页同步 =================
// 同一个 key 在另一个标签页被写入时，本页内存就过期了：继续用会让后保存的一方把先保存的覆盖回去。
// 这里只重读并重绘，绝不回写 —— 回写会制造第二个 storage 事件，两页互相触发。
window.addEventListener('storage', (e) => {
  if (e.key === null) { // 另一个标签页调用了 clear()
    loadMeta();
    if (meta.currentUid == null) ensureUser();
    applyUserData(meta.currentUid);
    renderUserList();
    rerenderCurrentPage();
    return;
  }
  if (e.key === META_KEY) {
    const mine = meta.currentUid;
    loadMeta();
    if (mine != null && meta.users.some(u => u.uid === mine)) {
      // 另一个标签页可能切换了「当前用户」：这是每个标签页各自的选择，本页不跟。
      meta.currentUid = mine;
    } else if (meta.currentUid == null) {
      // 本页的用户在另一个标签页被删光了 → 补一个，别让界面停在空 uid 上
      ensureUser();
      applyUserData(meta.currentUid);
      rerenderCurrentPage();
    } else {
      // 本页的用户被删 → 退到剩下用户里的第一个
      applyUserData(meta.currentUid);
      rerenderCurrentPage();
    }
    renderUserList();
    return;
  }
  if (e.key === `userData_${meta.currentUid}`) {
    applyUserData(meta.currentUid);
    renderUserList();
    rerenderCurrentPage();
    showToast('数据已在另一个标签页更新，本页已同步');
    return;
  }
  if (e.key && e.key.indexOf('userData_') === 0) { renderUserList(); return; } // 其它用户的持有数可能变了
  if (e.key === 'globalShowAttr') {
    showAttr = localStorage.getItem('globalShowAttr') !== 'false';
    const el = document.getElementById('attrToggle');
    if (el) el.checked = showAttr;
    rerenderCurrentPage();
  }
});
