// ================= 页面3：BOSS 分配（单行自由轨道） =================
// 左：非空队伍；右：多轮轨道，每轮 5 个 BOSS 列，队伍块可拖动/拉伸表示打掉的血量区间。

// 切换某轮自动续接占位的「生效 / 不生效」；tail=true 表示该轮右端的「尾部」占位（反向续接）
function toggleAutoContinuation(roundIdx, tail) {
  const key = tail ? 'autoOffTail' : 'autoOff';
  commit(() => {
    const offs = (bossPage[key] = bossPage[key] || []);
    const i = offs.indexOf(roundIdx);
    if (i >= 0) offs.splice(i, 1); else offs.push(roundIdx);
  }, renderBossPage);
}

// 构建「自动续接占位」块：无头像、不可拖动/拉伸/删除，宽度由相邻轮的贴边队伍位置决定。
// align='right' 为反向续接的尾部占位（钉在轨道右端）。灰色虚线描边（粗=生效 / 细=不生效），
// 点击切换是否计入分数；过窄时返回 null（不绘制）
function buildAutoPlaceholder(auto, roundIdx, align) {
  if (auto.w < AUTO_MIN_RENDER) return null;
  const tail = align === 'right';
  const el = document.createElement('div');
  el.className = 'placement placement-auto';
  if (auto.off) el.classList.add('placement-auto-off');
  el.dataset.teamId = auto.teamId;
  el.dataset.autoRound = roundIdx;
  el.style.left = tail ? `${(1 - auto.w) * 100}%` : '0%';
  el.style.width = `${auto.w * 100}%`;
  el.title = auto.off
    ? '自动续接占位（当前不生效，点击启用）'
    : '自动续接占位（当前生效，点击停用）';

  const score = document.createElement('div');
  score.className = 'placement-score';
  score.textContent = bossTeamScore(auto.teamId);
  el.appendChild(score);

  el.addEventListener('pointerdown', (e) => e.stopPropagation()); // 不触发轨道拖拽/落位
  el.addEventListener('click', (e) => { e.stopPropagation(); toggleAutoContinuation(roundIdx, tail); });
  return el;
}

// 续接链接 i−1 ↔ i：来源为「实体续接块」或「自动占位块」。返回 { enabled, auto, tail } 或 null。
// auto=true 表示链接由自动占位块产生（可点击切换启停）；实体续接块恒为 enabled。
// tail=true 表示反向续接：锚点在上一轮的右端，归属本轮贴左的队伍。
function linkIncoming(roundIdx) {
  const rounds = (bossPage && bossPage.rounds) || [];
  const round = rounds[roundIdx];
  if (!round || roundIdx <= 0) return null;
  const prev = rounds[roundIdx - 1] || [];
  // 前向：锚点在本轮左端（钉左续接块 / 本轮左端自动占位）
  const contBlock = round.find(p => p.cont);
  if (contBlock && prev.some(q => q.teamId === contBlock.teamId && isEdgeRight(q))) {
    return { enabled: true, auto: false, tail: false };
  }
  const auto = autoContinuation(roundIdx);
  if (auto) return { enabled: !auto.off, auto: true, tail: false };
  // 反向：锚点在上一轮右端（钉右续接块 / 上一轮右端自动占位）
  const tailBlock = prev.find(p => p.contTail);
  if (tailBlock && round.some(q => q.teamId === tailBlock.teamId && isEdgeLeft(q))) {
    return { enabled: true, auto: false, tail: true };
  }
  const autoT = autoTail(roundIdx - 1);
  if (autoT) return { enabled: !autoT.off, auto: true, tail: true };
  return null;
}

// 链接符号 ∝：in = 本轮轮次标签下方（左端）；out = 上一轮右侧（✕ 按钮所在的留白区）
// 传入的 roundIdx 为该边界的「后一轮」；反向续接的占位在前一轮，故停用下标要回退 1
function buildLinkBadge(roundIdx, kind, link) {
  const b = document.createElement('span');
  b.className = `track-link track-link-${kind}` + (link.enabled ? '' : ' track-link-off');
  b.textContent = '∝';   // 利用 color 着色：生效绿色 / 停用灰色（emoji 无法着色）
  if (link.auto) {
    const offIdx = link.tail ? roundIdx - 1 : roundIdx;
    b.classList.add('track-link-clickable');
    b.title = link.enabled ? '续接：与相邻轮次相连（点击停用）' : '续接：与相邻轮次相连（已停用，点击启用）';
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => { e.stopPropagation(); toggleAutoContinuation(offIdx, link.tail); });
  } else {
    b.title = '续接：与相邻轮次相连';
  }
  return b;
}

// 轨道节点缓存：下标 → .boss-track。拖拽/拉伸时 syncRoundLinks / syncAutoPlaceholder 每帧都会调用，
// 原来每次都要 querySelectorAll 整条 #bossTracks。渲染时维护这份缓存，长度对不上就回落实时查询（自愈）。
let trackNodeCache = [];
function bossTrackNode(i) {
  if (trackNodeCache.length !== bossPage.rounds.length) {
    trackNodeCache = Array.from(document.querySelectorAll('#bossTracks .boss-track'));
  }
  return trackNodeCache[i] || null;
}

// 同步第 roundIdx 轮的链接符号：本轮 rail 下方 + 上一轮右侧各一个
function syncRoundLinks(roundIdx) {
  const link = linkIncoming(roundIdx);
  const cur = bossTrackNode(roundIdx);
  if (cur) {
    const rail = cur.querySelector('.track-rail');
    rail.querySelectorAll(':scope > .track-link-in').forEach(n => n.remove());
    if (link) rail.appendChild(buildLinkBadge(roundIdx, 'in', link));
  }
  const prev = bossTrackNode(roundIdx - 1);
  if (prev) {
    prev.querySelectorAll(':scope > .track-link-out').forEach(n => n.remove());
    if (link) prev.appendChild(buildLinkBadge(roundIdx, 'out', link));
  }
}

// 与 autoContinuation / autoTail 结果保持一致：重建该轮占位块，并同步相邻的链接符号
function syncAutoPlaceholder(roundIdx) {
  const track = bossTrackNode(roundIdx);
  const grid = track && track.querySelector(':scope > .track-grid');
  if (grid) {
    grid.querySelectorAll(':scope > .placement-auto').forEach(n => n.remove());
    const auto = autoContinuation(roundIdx);
    if (auto) {
      const el = buildAutoPlaceholder(auto, roundIdx, 'left');
      if (el) grid.appendChild(el);
    }
    const autoT = autoTail(roundIdx);
    if (autoT) {
      const el = buildAutoPlaceholder(autoT, roundIdx, 'right');
      if (el) grid.appendChild(el);
    }
  }
  syncRoundLinks(roundIdx);
  syncRoundLinks(roundIdx + 1); // 尾部占位归属下一边界，需连带同步其链接符号
}

// 刷新一批队伍在全部轮次中所有块的分数显示（拖拽/拉伸时高频调用）。
// 只扫一遍 DOM、每支队伍只求值一次 —— 原来是「每支队伍各扫一遍 #bossTracks」，
// 指针移动时是 O(队伍数 × 块数) 的 DOM 遍历，长轨道上会有明显拖影。
function refreshTeamScores(teamIds) {
  const want = new Set(teamIds);
  const shown = new Map();
  document.querySelectorAll('#bossTracks .placement').forEach(el => {
    const id = Number(el.dataset.teamId);
    if (!want.has(id)) return;
    if (!shown.has(id)) {
      // 队伍已被删除的块首渲染显示「—」；这里保持一致，否则一次拖拽就会把「—」覆盖成
      // 一个看似正常的数字，而总分（只累加现存队伍）并不含它 —— 两处口径不同，更像是在算错分。
      shown.set(id, getTeamById(id) ? bossTeamScore(id) : '—');
    }
    const s = el.querySelector('.placement-score');
    if (s) s.textContent = shown.get(id);
  });
  refreshTotalScore();
}

function refreshTeamScore(teamId) { refreshTeamScores([teamId]); }

// 刷新与本轮及相邻轮相关的所有队伍的分数（缩放会同时波及左右两轮的续接占位块）
function refreshScoresAround(roundIdx) {
  const ids = new Set();
  for (let i = roundIdx - 1; i <= roundIdx + 1; i++) {
    const r = (bossPage && bossPage.rounds) ? bossPage.rounds[i] : null;
    if (r) r.forEach(p => ids.add(p.teamId));
  }
  refreshTeamScores(ids);
}

function refreshTotalScore() {
  const el = document.getElementById('totalScore');
  if (el) el.textContent = `总分数：${bossTotalScore()}`;
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
      img.loading = 'lazy';
      img.decoding = 'async';
      img.onerror = function () { handleImgError(this); };
      cell.appendChild(img);

      const char = charByName.get(slot.name);
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
    trackNodeCache = [];
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
    // 已使用（右面板已出现）且不满足「续接」例外（前向或反向任一）→ 变暗、不可拖出
    if (teamUsedRounds(team.id).length && teamReuseRound(team.id) < 0 && teamReuseRoundTail(team.id) < 0) {
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
  trackNodeCache = []; // 重建轨道 → 节点缓存作废（见 bossTrackNode）
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
        commit(() => {
          bossPage.rounds.splice(rIndex, 1);
          // autoOff / autoOffTail 存的是轮次下标：删掉中间一轮后其后整体前移，
          // 不做重映射会让「已停用」标记落到错误的轮次上（reload 前不会自我修正）
          const dropAndShift = arr => (Array.isArray(arr) ? arr : [])
            .filter(n => n !== rIndex)
            .map(n => (n > rIndex ? n - 1 : n));
          bossPage.autoOff = dropAndShift(bossPage.autoOff);
          bossPage.autoOffTail = dropAndShift(bossPage.autoOffTail);
        }, renderBossPage);
      });
      track.appendChild(del);
    }
    round.forEach((p, pIndex) => {
      // 队伍已被删除 → 不丢弃块：渲染为占位并明确标示「队伍已失效」，由用户决定是否移除
      const team = getTeamById(p.teamId);
      const orphan = !team;
      // 「续接」块（a2/a3…）：钉在本轮最左端，不可整体移动、无左手柄，只能靠右手柄向右拉伸
      const cont = isContinuationBlock(p);
      // 「尾部续接」块（反向续接）：钉在本轮最右端，不可整体移动、无右手柄，只能靠左手柄向左拉伸
      const contTail = isTailContinuationBlock(p);
      const el = buildTeamBlock(orphan ? { slots: [null, null, null] } : team);
      el.classList.add('placement');
      if (orphan) el.classList.add('placement-orphan');
      if (cont) el.classList.add('placement-locked');
      if (contTail) el.classList.add('placement-locked-tail');
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
        commit(() => { bossPage.rounds[rIndex].splice(pIndex, 1); }, renderBossPage);
      });
      el.appendChild(del);

      // 左右边缘拖动 → 连续调整该队占用的血量区间（不越过相邻队伍）
      // 前向续接块钉左端：无左手柄；反向续接块钉右端：无右手柄
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

      if (!contTail) {
        const rzR = document.createElement('div');
        rzR.className = 'placement-resize placement-resize-right';
        rzR.title = '拖动调整右边界';
        rzR.addEventListener('pointerdown', (e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          e.stopPropagation();
          BossDrag.beginResize(e, rIndex, pIndex, 'right');
        });
        el.appendChild(rzR);
      }

      // 续接块不可整体移动（前向钉左端、反向钉右端），只能靠另一侧手柄拉伸
      if (!cont && !contTail) setupBossDrag(el, 'move', { round: rIndex, index: pIndex });
      grid.appendChild(el);
    });
    // 自动续接占位：R 轮贴边队伍的续接输出，补齐 R+1 轮最左端放不下队伍块的空隙
    const auto = autoContinuation(rIndex);
    if (auto) {
      const ph = buildAutoPlaceholder(auto, rIndex, 'left');
      if (ph) grid.appendChild(ph);
    }
    // 自动尾部占位（反向）：R+1 轮贴左队伍的续接输出，补齐 R 轮最右端的空隙
    const autoT = autoTail(rIndex);
    if (autoT) {
      const ph = buildAutoPlaceholder(autoT, rIndex, 'right');
      if (ph) grid.appendChild(ph);
    }
    // 续接链接符号：本轮标签下方（指向 R−1↔R）+ 上一轮右侧（指向 R↔R+1）
    const linkIn = linkIncoming(rIndex);
    if (linkIn) rail.appendChild(buildLinkBadge(rIndex, 'in', linkIn));
    const linkOut = linkIncoming(rIndex + 1);
    if (linkOut) track.appendChild(buildLinkBadge(rIndex + 1, 'out', linkOut));
    tracks.appendChild(track);
    trackNodeCache.push(track);
  });
}

// 新一轮
document.getElementById('addRoundBtn').addEventListener('click', () => {
  if (meta.currentUid == null) return;
  commit(() => { bossPage.rounds.push([]); }, renderBossPage);
});

// ================= 页面3 拖拽 =================
// 两种手势共用一套骨架（见 drag.js）：
//   移动 = 左面板队伍拖入（new-team）/ 轨道内块移动（move）
//   拉伸 = 块左右边缘（立即生效、每帧合并落位）
const BossDrag = createDrag({
  sourceSelector: '.placement, .boss-team',

  // 拉伸：按下即开始，先把上下文准备好
  onStart(c) {
    const p = c.payload;
    c.resizeCtx = { rIndex: p.rIndex, pIndex: p.pIndex };
    c.resizeSide = p.side;
    if (c.sourceEl) c.sourceEl.classList.add('placement-resizing'); // 拖动期间锁定高亮，避免闪烁
  },

  onActivate(c) {
    const el = c.sourceEl;
    const sr = el.getBoundingClientRect();
    let gw = sr.width, gh = sr.height, gridW = 0;
    if (c.payload.mode === 'move') {
      // 同尺寸幽灵：宽度与源块一致
      const grid = el.closest('.track-grid');
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
    c.gridW = gridW || 1;
    c.grabPx = sr.width ? (c.sx - sr.left) : gw / 2;
    c.grabPy = sr.height ? (c.sy - sr.top) : gh / 2;

    // 从左面板新建时，幽灵按落位后的块样式渲染（头像随块高缩放）；
    // 否则会沿用左面板的头像尺寸而撑出块外
    const ghost = makeGhostFrom(el, c.payload.mode === 'new-team' ? 'placement' : '');
    if (c.payload.mode === 'new-team') ghost.classList.remove('boss-team');
    ghost.style.width = `${gw}px`;
    ghost.style.height = `${gh}px`;
    c.ghost = ghost;
  },

  onMove(c, x, y) {
    if (c.payload.mode === 'resize') { resizeQueue.push(x); return; }
    bossTrackGhost(c, x, y);
  },

  onBeforeEnd(c) {
    // 先把可能还压在 rAF 里的最后一帧落位，再收尾
    if (c.payload && c.payload.mode === 'resize') resizeQueue.flush();
  },

  onEnd(c, payload, x, y) {
    if (payload.mode === 'resize') {
      // 缩短后不再贴住本轮最右端 → 后续续接块失去支撑，级联删除并重渲染轨道
      const removed = pruneContinuations();
      saveData(); // 内部会再幂等清理一次并落盘
      if (removed) renderBossPage();
      return;
    }
    bossDrop(c, payload, x, y);
  },

  onCleanup(c) {
    if (c.sourceEl) c.sourceEl.classList.remove('placement-resizing');
    document.querySelectorAll('.track-grid.drag-target, .track-grid.drag-blocked').forEach(g => {
      g.classList.remove('drag-target'); g.classList.remove('drag-blocked');
    });
    setReleaseHoverOverlay(null, false);
    resizeQueue.clear();
    c.resizeCtx = null; c.resizeSide = null;
  },
});

// 拉伸落位合并到每帧一次（高刷鼠标 / 触屏抖动时，一帧内可能来 2~4 个 pointermove）
const resizeQueue = createFrameQueue(x => BossDrag._doResize(x));

// 移动模式：抓取点占轨道宽度的比例（幽灵左端 → 指针）
function bossGrabFrac(c) { return c.grabPx / c.gridW; }

// 当前被拖块在目标轨道中的宽度与应排除的下标（同轨道移动时排除自身）
function bossDragInfo(c, targetRound) {
  if (c.payload.mode === 'new-team') return { w: BOSS_DEF_W, exclude: -1 };
  const srcRound = bossPage.rounds[c.payload.source.round];
  const p = srcRound && srcRound[c.payload.source.index];
  if (!p) return null;
  return { w: p.w, exclude: c.payload.source.round === targetRound ? c.payload.source.index : -1 };
}

// 「续接」例外的新队伍：只接受落到例外轮次的指定边缘（前向→最左端 / 反向→最右端），其余位置视为不可放置
function bossReuseOk(c, roundIdx, fit) {
  if (c.payload.mode !== 'new-team') return true;
  if (c.reuseRound < 0 && c.reuseRoundTail < 0) return true;
  if (!fit) return false;
  if (c.reuseRound >= 0 && roundIdx === c.reuseRound && fit.x <= EDGE_TOL) return true;
  if (c.reuseRoundTail >= 0 && roundIdx === c.reuseRoundTail && fit.x + fit.w >= 1 - EDGE_TOL) return true;
  return false;
}

// 幽灵跟随指针：落在轨道上时吸附到不重叠的最终位置，直观预告松手结果
function bossTrackGhost(c, cx, cy) {
  if (!c.ghost) return;
  const el = document.elementFromPoint(cx, cy);
  const leftPanel = document.querySelector('#bossPage .left-panel');
  document.querySelectorAll('.track-grid.drag-target, .track-grid.drag-blocked').forEach(g => {
    g.classList.remove('drag-target'); g.classList.remove('drag-blocked');
  });
  if (leftPanel) setReleaseHoverOverlay(null, false);

  const grid = el && el.closest('.track-grid');
  if (!grid) {
    // 幽灵脱离轨道时跟随指针（保持抓取点不动）
    c.ghost.style.left = `${cx - c.grabPx}px`;
    c.ghost.style.top = `${cy - c.grabPy}px`;
    if (c.payload.mode === 'move' && leftPanel && leftPanel.contains(el)) setReleaseHoverOverlay(leftPanel, true);
    return;
  }
  const rect = grid.getBoundingClientRect();
  const roundIdx = parseInt(grid.closest('.boss-track').dataset.round, 10);
  const round = bossPage.rounds[roundIdx];
  const info = round ? bossDragInfo(c, roundIdx) : null;
  const fit = info ? bossFreeX(round, (cx - rect.left) / rect.width - bossGrabFrac(c), info.w, info.exclude, true) : null;
  if (!fit || !bossReuseOk(c, roundIdx, fit)) {
    grid.classList.add('drag-blocked'); // 放不下 / 例外落点不符：不吸附，仅跟随
    c.ghost.style.left = `${cx - c.grabPx}px`;
    c.ghost.style.top = `${cy - c.grabPy}px`;
  } else {
    grid.classList.add('drag-target');
    c.ghost.style.left = `${rect.left + fit.x * rect.width}px`;
    c.ghost.style.top = `${rect.top + trackInsetTop(grid)}px`;
    // 落位被收缩进窄间隔时，幽灵同步变窄以预告结果
    c.ghost.style.width = `${fit.w * rect.width}px`;
  }
}

function bossDrop(c, payload, clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) return;
  const grid = el.closest('.track-grid');
  const leftPanel = document.querySelector('#bossPage .left-panel');

  if (grid) {
    const rect = grid.getBoundingClientRect();
    const roundIdx = parseInt(grid.closest('.boss-track').dataset.round, 10);
    const round = bossPage.rounds[roundIdx];
    const info = round ? bossDragInfo(c, roundIdx) : null;
    if (!info) return;
    const fit = bossFreeX(round, (clientX - rect.left) / rect.width - bossGrabFrac(c), info.w, info.exclude, true);
    if (!fit || !bossReuseOk(c, roundIdx, fit)) return; // 无处可放 / 例外落点不符：保持原状
    commit(() => {
      if (payload.mode === 'new-team') {
        const rec = { teamId: payload.source.teamId, x: r4(fit.x), w: r4(fit.w) };
        // 经例外拖出 → 打出续接标记，供级联清理与「续接块」渲染识别（前向 cont / 反向 contTail）。
        // 判据与 bossReuseOk 完全一致（含落点边缘校验、同为「前向后反向」序）：
        // 否则同一轮次既是前向目标又是反向目标时，会按轮次错标方向。
        if (c.reuseRound >= 0 && roundIdx === c.reuseRound && fit.x <= EDGE_TOL) rec.cont = true;
        else if (c.reuseRoundTail >= 0 && roundIdx === c.reuseRoundTail && fit.x + fit.w >= 1 - EDGE_TOL) rec.contTail = true;
        round.push(rec);
      } else {
        const srcRound = bossPage.rounds[payload.source.round];
        const p = srcRound && srcRound[payload.source.index];
        if (!p) return;
        srcRound.splice(payload.source.index, 1);
        round.push({ teamId: p.teamId, x: r4(fit.x), w: r4(fit.w) });
      }
    }, renderBossPage);
  } else if (payload.mode === 'move' && leftPanel && leftPanel.contains(el)) {
    // 拖回左面板（整块面板都是释放区）= 移除该分配
    const srcRound = bossPage.rounds[payload.source.round];
    if (srcRound && srcRound[payload.source.index]) {
      commit(() => { srcRound.splice(payload.source.index, 1); }, renderBossPage);
    }
  }
}

// 拉伸：左缘变化影响本轮「前向自动占位」宽度（= 本轮最左缘）；
//       右缘变化影响「反向自动占位」宽度（= 1 − 本轮最右缘）。
// 这里只调整被拖的那一块，随后同步占位块、左面板可用状态与相关队伍分数。
function bossDragDoResize(clientX) {
  const c = BossDrag.ctx;
  const ctx = c.resizeCtx;
  if (!ctx) return;
  const round = bossPage.rounds[ctx.rIndex];
  const p = round && round[ctx.pIndex];
  if (!p) return;
  const grid = c.sourceEl && c.sourceEl.closest('.track-grid');
  if (!grid) return;
  const rect = grid.getBoundingClientRect();
  if (!rect.width) return;
  const frac = (clientX - rect.left) / rect.width;
  const bound = bossNeighborBounds(round, ctx.pIndex);
  const wasX = p.x;
  const wasRight = p.x + p.w;
  const wasEdgeRight = isEdgeRight(p);
  const wasEdgeLeft = isEdgeLeft(p);
  if (c.resizeSide === 'left') {
    // 右缘不动，左缘跟随指针；不越过左邻右缘、不低于最小宽度
    const rightEdge = p.x + p.w;
    const minX = bound.left;
    const x = Math.max(minX, Math.min(Math.max(minX, rightEdge - BOSS_MIN_W), frac));
    p.x = r4(x);
    p.w = r4(rightEdge - x);
    c.sourceEl.style.left = `${p.x * 100}%`;
    c.sourceEl.style.width = `${p.w * 100}%`;
  } else {
    // 左缘不动，右缘跟随指针；不越过右邻左缘、不低于最小宽度
    const hi = Math.min(1, bound.right);
    const rightEdge = Math.max(p.x + BOSS_MIN_W, Math.min(hi, frac));
    p.w = r4(rightEdge - p.x);
    c.sourceEl.style.width = `${p.w * 100}%`;
  }
  // 左缘变化 → 本轮「前向自动占位」宽度随之改变，实时同步
  if (p.x !== wasX) syncAutoPlaceholder(ctx.rIndex);
  // 右缘变化 → 本轮「反向自动占位」宽度随之改变，实时同步
  // （左、右拉伸各自只改动一侧边缘，故以上两条最多命中一条）
  if (p.x + p.w !== wasRight) syncAutoPlaceholder(ctx.rIndex);
  // 「是否贴住最右端」翻转 → 该队「续接」例外成立与否随之改变（反向例外也依赖「本轮无贴右块」）：
  //   刷新左面板可用状态，并同步下一轮的前向自动占位与本轮的反向自动占位
  if (isEdgeRight(p) !== wasEdgeRight) {
    renderBossTeamList();
    syncAutoPlaceholder(ctx.rIndex);
    syncAutoPlaceholder(ctx.rIndex + 1);
  }
  // 「是否贴住最左端」翻转 → 本队反向「尾部」例外成立与否随之改变：
  //   刷新左面板可用状态，并同步上一轮的反向自动占位
  if (isEdgeLeft(p) !== wasEdgeLeft) {
    renderBossTeamList();
    syncAutoPlaceholder(ctx.rIndex - 1);
  }
  // 缩放波及本轮块的列跨度、本轮占位块（属上一轮贴边的 a 队）、下一轮占位块：
  // 必须逐队刷新，否则占位块的分不会实时并入 a 队（需刷新页面才更新）
  refreshScoresAround(ctx.rIndex);
}

// 供拖拽骨架调用（保留方法名，便于单测直接验证合并行为）
BossDrag._queueResize = x => resizeQueue.push(x);
BossDrag._flushResize = () => resizeQueue.flush();
BossDrag._doResize = x => bossDragDoResize(x);

BossDrag.beginResize = function (e, rIndex, pIndex, side) {
  BossDrag.beginNow(e, {
    mode: 'resize',
    rIndex, pIndex,
    side: side === 'left' ? 'left' : 'right',
    sourceEl: e.currentTarget.parentElement,
  });
};

// 拖出前先判定是否允许：已用过的队伍只有「续接」例外才能再放一次
function bossDragBegin(e, mode, source, isTouch) {
  const c = BossDrag.ctx;
  c.reuseRound = -1;
  c.reuseRoundTail = -1;
  if (mode === 'new-team' && teamUsedRounds(source.teamId).length) {
    const rr = teamReuseRound(source.teamId);       // 前向：落到第 rr 轮最左端
    const rt = teamReuseRoundTail(source.teamId);   // 反向：落到第 rt 轮最右端
    if (rr < 0 && rt < 0) return;                   // 左边块已变暗，这里兜底拦截
    c.reuseRound = rr;
    c.reuseRoundTail = rt;
  }
  BossDrag.begin(e, { mode, source, sourceEl: e.currentTarget }, isTouch);
}

function setupBossDrag(el, mode, source) {
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    bossDragBegin(e, mode, source, e.pointerType !== 'mouse');
  });
}
