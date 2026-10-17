// ================= 页面3 数据模型：排布、续接、计分 =================
// 数据模型：bossPage = { bossNames:[5], rounds:[ [ {teamId, x, w} ... ], ... ], autoOff, autoOffTail }
//   x : 左端位置占轨道宽度比例 0~1（连续值，非列对齐）
//   w : 宽度占轨道宽度比例（连续值）——宽度即该队伍打掉的血量占比
//   多个队伍在同一 BOSS 区间内首尾相接、可跨列；跨轮次用“队伍复用（拖两次）”表达
// 本文件是纯模型层：不碰 DOM（只有 normalizeBossPage 之外没有副作用），便于单独测试。

// 5 个 BOSS 的初始名称（游戏内 BOSS 更新时手动修改）
const BOSS_DEF_NAMES = ['燎照之骑', '封庭械囿', '无冠者', '天傀劫煞', '矩阵奇藏'];

const BOSS_MIN_W = 0.07;   // 最小宽度（比例），保证头像仍可辨认
const BOSS_DEF_W = 0.2;    // 从左侧拖入时的默认宽度（约等于一个 BOSS 列）
const r4 = v => Math.round(v * 10000) / 10000;

// ===== 计分 =====
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

// 同一队伍跨轮次出现 → 各块分数相加；该队伍的所有队伍块显示同一个合计值
function bossTeamScore(teamId) {
  const team = getTeamById(teamId);
  // 队伍已删除（页面3 显示为「队伍已失效」）或三个人位全空 → 打不出伤害。
  // 空队伍块只可能来自「先拖到页面3，之后在页面2 把该队清空」，不是设计出来的状态；
  // 若不判空，块上会一直显示分数、总分也照算，用户会以为「已经没人的队还在打」。
  if (!team || !Array.isArray(team.slots) || !team.slots.some(s => s)) return 0;
  const rounds = (bossPage && bossPage.rounds) || [];
  let total = 0;
  rounds.forEach((round, rIndex) => {
    round.forEach(p => { if (p.teamId === teamId) total += bossBlockScore(rIndex, p); });
    // 生效中的自动续接占位同样计入（该队伍本轮可能没有实体块）
    const auto = autoContinuation(rIndex);
    if (auto && !auto.off && auto.teamId === teamId) total += bossBlockScore(rIndex, { x: 0, w: auto.w });
    // 反向：本轮右端空隙归属下一轮贴左的队伍
    const autoT = autoTail(rIndex);
    if (autoT && !autoT.off && autoT.teamId === teamId) total += bossBlockScore(rIndex, { x: 1 - autoT.w, w: autoT.w });
  });
  return Math.round(total / SCORE_UNIT) * SCORE_UNIT;
}

// 战斗总分数：各队伍分数之和。同一队伍跨轮次的续接块在界面上重复显示同一个队伍总分，
// 因此按队伍去重累加（而非逐个块累加），避免续接块被重复计入。
function bossTotalScore() {
  let total = 0;
  (teams || []).forEach(t => { total += bossTeamScore(t.id); });
  return total;
}

// ===== 自动续接占位 =====
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

// 「自动尾部占位」（反向续接，与 autoContinuation 镜像）：R+1 轮最左端有队伍 b1 紧贴左端，
// R 轮右端留有空隙、且最右块末端仍在最后一个 BOSS 范围内时，
// [最右块末端, 1) 这段空隙视为 b1 从下一轮延续回来的输出。返回 { teamId, w, off }。
// 与前向对称：空隙 > 0 即派生（分数照算），细到 AUTO_MIN_RENDER 以下只是不绘制占位块。
// 与前向的互斥是严格成立的：两侧来源判据都是「精确贴边」(EDGE_TOL = 1e-6)，前向来源成立时本轮最右
// 缘必为 1，本函数要求的「右端仍有空隙」随即不成立；反向同理。故两个方向不可能同时派生。
function autoTail(roundIdx) {
  const rounds = (bossPage && bossPage.rounds) || [];
  const round = rounds[roundIdx];
  const next = rounds[roundIdx + 1];
  if (!round || !round.length || !next) return null; // 本轮为空 / 没有下一轮 → 不出现
  let b1 = null; // 取最靠左的那个贴边块作为续接来源
  next.forEach(p => { if (isEdgeLeft(p) && (!b1 || p.x < b1.x)) b1 = p; });
  if (!b1) return null;
  if (!getTeamById(b1.teamId)) return null; // 来源队伍已被删除 → 不派生占位
  if (round.some(p => p.teamId === b1.teamId)) return null; // 该队本轮已有实体块
  const rightmost = round.reduce((m, p) => Math.max(m, Math.min(1, p.x + p.w)), 0);
  if (rightmost >= 1 - 1e-6) return null;                   // 空隙为零：最右块恰好贴到右端，无空隙可续接
  if (rightmost < 1 - 1 / BOSS_COLS - 1e-9) return null;    // 空隙已超出最后一个 BOSS 范围
  const off = ((bossPage.autoOffTail) || []).indexOf(roundIdx) >= 0;
  return { teamId: b1.teamId, w: 1 - rightmost, off };
}

// 自动续接占位小于此宽度时不绘制（仍照常计分）：细到难以辨识，改由 ∝ 链接符号表达其存在
const AUTO_MIN_RENDER = 0.01;

// ===== 队伍使用限制 =====
// 每个队伍只能使用 1 次：已在右面板出现过的队伍，左面板中变暗且不可再拖出，直到右面板释放。
// 例外（「续接」）分两个方向，都以同一轮次边界为轴：
//   前向：该队在第 r 轮紧贴最右端，且第 r+1 轮最左端无队伍
//         → 允许再放到第 r+1 轮最左端，表示它从上一轮末尾继续打下一轮。
//   反向：该队在第 r+1 轮紧贴最左端，且第 r 轮最右端无队伍
//         → 允许再放到第 r 轮最右端，表示它在上一轮末尾就已经开始打。
// 「紧贴轨道左/右端」的容差（占轨道宽度的比例）。取 1e-6 表示**精确贴边**：块位置经 r4 量化在
// 1e-4 网格上，故 1e-6 只吸收浮点误差，实际等价于「精确落到 0 / 1」。拖拽与拉伸在越界时会 clamp
// （bossFreeX 的 min(g.e-w2, x) / 拉伸的 max(minX,·)），所以把块推到墙上仍能稳定命中。
// 之所以不留 2% 宽容带：宽容带会让「已贴边」与「另一侧无空隙」变成两回事，从而允许前向、反向
// 两个占位在同一轮次边界同时成立。精确贴边后两者重新等价，两个方向自动互斥（无需任何单侧特权）。
const EDGE_TOL = 1e-6;

const isEdgeRight = p => p.x + p.w >= 1 - EDGE_TOL;
const isEdgeLeft = p => p.x <= EDGE_TOL;

// 该队伍已出现在哪些轮次
function teamUsedRounds(teamId) {
  const out = [];
  ((bossPage && bossPage.rounds) || []).forEach((round, r) => {
    if (round.some(p => p.teamId === teamId)) out.push(r);
  });
  return out;
}

// 前向例外允许落位的轮次下标；无例外返回 -1
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

// 反向例外允许落位的轮次下标（该队紧贴第 r+1 轮最左端 → 可回到第 r 轮最右端）；无例外返回 -1
function teamReuseRoundTail(teamId) {
  const rounds = (bossPage && bossPage.rounds) || [];
  for (let r = rounds.length - 2; r >= 0; r--) {
    const next = rounds[r + 1];
    if (!next.some(p => p.teamId === teamId && isEdgeLeft(p))) continue;
    const cur = rounds[r];
    if (cur.some(p => p.teamId === teamId)) continue;    // 该轮已有此队，不重复放置
    if (cur.some(p => isEdgeRight(p))) continue;         // 该轮最右端已被贴住
    return r;
  }
  return -1;
}

// 是否为「续接」块：经例外拖出时打上的标记。
//   cont     → 前向（a2/a3…）：钉在本轮最左端，不可整体拖动，只能靠右手柄向右拉伸。
//   contTail → 反向：钉在本轮最右端，不可整体拖动，只能靠左手柄向左拉伸。
function isContinuationBlock(p) { return !!p.cont; }
function isTailContinuationBlock(p) { return !!p.contTail; }

// 续接链完整性：续接块必须由相邻轮同队的贴边块支撑，支撑失效时级联删除。
//   前向（cont，钉左）支撑在【上一轮】→ 按轮次升序处理，形成 a1→a2→a3 的连锁清理。
//   反向（contTail，钉右）支撑在【下一轮】→ 按轮次降序处理，形成 b1→b2→b3 的反向连锁清理。
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
  for (let r = rounds.length - 2; r >= 0; r--) {
    const round = rounds[r];
    const next = rounds[r + 1];
    for (let i = round.length - 1; i >= 0; i--) {
      const p = round[i];
      if (!p.contTail) continue;
      if (!validIds.has(p.teamId)) continue;
      if (next.some(q => q.teamId === p.teamId && isEdgeLeft(q))) continue; // 支撑仍在
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

function defaultBossPage() {
  // autoOff：被用户点成「不生效」的前向自动占位所在轮次下标集合
  // autoOffTail：反向（尾部）自动占位的「不生效」轮次下标集合
  return { bossNames: BOSS_DEF_NAMES.slice(), rounds: [[]], autoOff: [], autoOffTail: [] };
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
      if (p.cont) rec.cont = true;         // 保留「前向续接块」标记
      if (p.contTail) rec.contTail = true; // 保留「反向续接块」标记
      return rec;
    }));
  if (!rounds.length) rounds = [[]];
  // 消除重叠：按左端升序依次安置，重叠的推到最近的可放位置（兼容旧版允许重叠的数据）
  rounds = rounds.map(r => {
    const out = [];
    r.slice().sort((a, b) => a.x - b.x).forEach(p => {
      const fit = bossFreeX(out, p.x, p.w, -1);
      const rec = { teamId: p.teamId, x: r4(fit ? fit.x : p.x), w: p.w };
      if (p.cont) rec.cont = true;
      if (p.contTail) rec.contTail = true;
      out.push(rec);
    });
    return out;
  });
  // 自动续接占位的「不生效」轮次：只保留仍存在的轮次下标
  const autoOff = Array.isArray(bp.autoOff)
    ? bp.autoOff.filter(n => Number.isInteger(n) && n > 0 && n < rounds.length)
    : [];
  // 反向（尾部）占位的「不生效」轮次：占位出现在第 n 轮右端，故 n 只需有下一轮可续
  const autoOffTail = Array.isArray(bp.autoOffTail)
    ? bp.autoOffTail.filter(n => Number.isInteger(n) && n >= 0 && n < rounds.length - 1)
    : [];
  return { bossNames: names, rounds, autoOff, autoOffTail };
}
