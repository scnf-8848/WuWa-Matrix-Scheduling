// ================= 布局 =================
// 只做“量 DOM → 算尺寸 → 写 CSS 变量网格”，不碰业务数据。

/* ===== 页面2 队伍排布 =====
   1. 分列只看容量：一列装得下（不压缩时能放 capNat 行）就单列居中；装不下才分两列，
      且先填满左列、余数才进右列 —— 两列时每列行数取 capNat 而不是均分，这样左列已经
      排好的队伍不会因为多了一支而整体重排。右列即使空着也保留轨道位置。
   2. 行高吃满可用高度（上限 TL_MAX_ROW），而不是钉死在自然行高上，避免底部集中留白；
      行高有富余时把整块网格垂直居中，让留白上下均分。
   3. 分列不能靠"纵向浪费比例"这类启发式（见下面 n <= capNat 分支的注释）：它算的是
      内容总高占可用高度的比例，与"一列还能不能放下一行"无关，队伍数一变就会提前分列。
   4. 若最好的方案仍低于可读下限 TL_MIN_SLOT，放弃“一屏全显”，改用固定舒适行高并允许纵向滚动。
   5. 单列时队伍块不拉满整行：宽度收到“刚好不再被宽度限制”的 TL_ROW_MAX_W 并水平居中。 */
const TL_MIN_SLOT = 28;    // 头像位可读下限
const TL_MAX_SLOT = 55;    // 头像位上限
const TL_MAX_ROW = 72;     // 行高上限：块高 = 头像 55 + 上下各 8.5，再高就只是白留（原来 78 上下各留 11.5，整块显得空）
const TL_SCROLL_ROW = 60;  // 滚动模式行高（与 .team-row 的 min-height 一致）
const TL_NATURAL_ROW = 70; // 自然行高：低于它即视为“压缩了队伍块”
const TL_GAP = 10;         // 行距
const TL_GAP_COLS = 20;    // 列距
const TL_FIXED_W = 132;    // 每行除头像位外的固定宽度（把手 + 队伍名 + 内边距 + 头像间隔 + 右侧 26px 的删队伍 × 留白）
const TL_ROW_MAX_W = TL_FIXED_W + 3 * TL_MAX_SLOT; // 单列队伍块的最大宽度：再宽也换不来更大的头像

// 试算某一列数方案：返回头像位尺寸、行高与内容总高。
// opts.perCol 可指定每列行数（容量优先排布）；opts.row 可强制行高（滚动兜底）。
function teamLayoutCandidate(colCount, availH, width, n, opts) {
  const o = opts || {};
  const perCol = o.perCol != null ? o.perCol : Math.max(1, Math.ceil(n / colCount));
  const rowBudget = o.row != null
    ? o.row
    : Math.min(TL_MAX_ROW, (availH - (perCol - 1) * TL_GAP) / perCol);
  // 上下内边距之和（CSS 里 each = padV / 2）。上限 17 而不是 20：行高上限已收到 72，
  // 若还允许 20，slotFromV 就只剩 52，头像会被行高而不是宽度卡小 —— 那是反的。
  // 下限 10 保证压扁时（滚动模式 60）仍有可点的边距。
  const padV = Math.max(10, Math.min(17,
      (rowBudget - 32) / (TL_NATURAL_ROW - 32) * 10 + 10));
  const colW = (width - (colCount - 1) * TL_GAP_COLS) / colCount;
  const slotFromV = rowBudget - padV;
  const slotFromW = (colW - TL_FIXED_W) / 3;
  const slot = Math.max(4, Math.min(TL_MAX_SLOT, slotFromV, slotFromW));
  // 这里不返回内容总高：真正的行高要按「头像 + 上下边距」回算（见 updateLayoutScale），
  // 用 rowBudget 估出来的那个值在列宽卡住头像时会偏大，拿它判居中会多留白。
  return { colCount, perCol, padV, slot, rowBudget };
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
  // 防御：0 支队伍时任何行数推算都没有意义（perCol 会算成 0，产生非法 grid-template-rows）
  if (!n) {
    section.style.gridTemplateRows = '';
    section.style.setProperty('--slot-size', `${TL_MAX_SLOT}px`);
    return;
  }
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
    if (n <= capNat) {
      // 一列装得下 → 单列居中，块宽收到可读上限（比两列的半宽更宽，头像也更大）。
      // 这里不再拿两列方案做对比：两列要占两条轨道各半宽，右列还空着，块会缩窄并贴左，
      // 而一列明明没满 —— 视觉上就是"靠左排列"。之前那个"纵向浪费超过 1/4 就改单列"
      // 的启发式正是这种跳变的来源：它比的是内容总高 / 可用高度，队伍数一变就可能在这条
      // 线两侧来回跨，跨过去就分列，跟"一列还能不能再放一行"完全无关。
      best = teamLayoutCandidate(1, availH, width, n);
    } else {
      // 一列装不下：先尽量排满左列，再把余数放进右列；只有两列都装不下才回到均分并压缩
      const twoPerCol = n <= capNat * 2 ? capNat : Math.ceil(n / 2);
      const two = teamLayoutCandidate(2, availH, width, n, { perCol: twoPerCol });
      const one = teamLayoutCandidate(1, availH, width, n);
      best = two;
      // 兜底：面板窄到两列的头像已经读不清（被列宽卡住）时，宁可单列压缩行高 ——
      // 单列明显更大，或两列已跌破可读下限而单列还能救。宽面板下这两条都不成立。
      if (one.slot > two.slot * 1.15
          || (two.slot < TL_MIN_SLOT && one.slot > two.slot)) {
        best = one;
      }
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
  // 行高按「实际头像 + 上下边距」回算，而不是直接用 rowBudget：
  // 列宽先卡住头像时（两列、面板窄），rowBudget 与 slot 之间那段差额只会变成块内
  // 上下的白留 —— 头像 48 + 行高 72 就是上下各 12px 的空壳，队伍块显得空。
  // 收紧后块高 = slot + padV，边距仍是 .team-row 的 padding；但不能再顶大：
  // 下限只用来挡「比 min-height 还矮」的抖动，外面再套一层 min(rowBudget)，
  // 免得行高被下限抬高、把内容挤出可用高度（那样会压到下一行 / 撑出滚动条）。
  const rowH = Math.min(best.rowBudget,
      Math.max(TL_SCROLL_ROW, Math.round(best.slot + best.padV)));
  const contentH = rowH * best.perCol + (best.perCol - 1) * TL_GAP;
  section.style.gridTemplateRows = `repeat(${best.perCol}, ${rowH}px)`;
  // 两列：始终保留两条轨道（左列靠最左）；单列：宽度收到上限，不拉满整行，整体水平居中
  section.style.gridTemplateColumns = best.colCount === 1
    ? `min(100%, ${TL_ROW_MAX_W}px)`
    : 'minmax(0,1fr) minmax(0,1fr)';
  section.style.justifyContent = best.colCount === 1 ? 'center' : '';
  section.style.gridAutoFlow = 'column';
  // 内容不足一屏 → 垂直居中（留白上下均分）；满屏或滚动 → 顶部对齐
  section.style.alignContent = (!scroll && contentH < availH - 2) ? 'center' : 'start';
  section.classList.toggle('team-scroll', scroll);
}

// ===== 页面3 尺寸 =====
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

// resize 会在拖动窗口/手机地址栏伸缩时连续触发，而 updateLayoutScale 里全是
// getComputedStyle + clientHeight 这类强制同步布局，逐次执行会造成明显卡顿 → 合并到每帧一次。
let resizeRaf = 0;
window.addEventListener('resize', function () {
  if (resizeRaf) return;
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = 0;
    if (!document.getElementById('teamPage').classList.contains('hidden')) { updateLayoutScale(); return; }
    if (!document.getElementById('bossPage').classList.contains('hidden')) updateBossLayout();
  });
});
