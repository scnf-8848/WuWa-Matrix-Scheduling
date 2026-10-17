// ================= 布局 =================
// 只做“量 DOM → 算尺寸 → 写 CSS 变量网格”，不碰业务数据。

/* ===== 页面2 队伍排布 =====
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
