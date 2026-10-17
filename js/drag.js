// ================= 通用指针拖拽控制器 =================
// 页面2 的「角色池 → 队伍槽位」、页面2 的「队伍整行排序」、页面3 的「分配块移动/拉伸」，
// 三套拖拽的骨架完全一样：
//   按下 →（触屏长按 220ms / 鼠标位移 8px）→ 激活（造幽灵、锁滚动）
//        → 跟随指针 → 松手落位 → 统一清理
// 以前这段骨架被复制了三份（约 600 行），改一个细节要改三处、还容易改漏一处。
// 现在只留这一份，各页面通过 3 个钩子提供差异：
//   onActivate(c, x, y)  激活时造幽灵、给源元素加拖拽态
//   onMove(c, x, y)      指针移动（已激活）
//   onEnd(c, payload, x, y)  松手（仅激活过才调用）
// 以及 onStart（立即生效的拖拽，如拉伸）、onBeforeEnd（收尾前补一帧）、onCleanup（清自己造的东西）。

const DRAG_THRESHOLD = 8;        // 鼠标按下后位移超过它就进入拖拽
const TOUCH_HOLD_DELAY = 220;    // 触屏长按多久算拖拽（区分“滑动面板”与“拖东西”）
const TOUCH_SCROLL_CANCEL = 10;  // 长按确认前位移超过它 → 判定为滑动，取消本次拖拽

// 造幽灵：克隆源元素、去掉“拖拽中”的态、加上统一描边类
function makeGhostFrom(el, extraClass) {
  const g = el.cloneNode(true);
  g.classList.remove('drag-sourcing');
  g.classList.add('drag-ghost');
  if (extraClass) g.classList.add(extraClass);
  document.body.appendChild(g);
  return g;
}

// 高频回调（拉伸落位）合并到每帧一次：指针事件频率通常高于帧率（高刷鼠标、触屏抖动），
// 每个事件都算一遍的话一帧内会重复做 2~4 次分数重算与 DOM 写入，纯属浪费。
function createFrameQueue(fn) {
  let rafId = 0;
  let pending = null;
  return {
    push(v) {
      pending = v;
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        const x = pending; pending = null;
        if (x != null) fn(x);
      });
    },
    // 松手前把最后一帧尚未执行的位置立刻落地，否则最终宽度会少算一帧
    flush() {
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      const x = pending; pending = null;
      if (x != null) fn(x);
    },
    clear() {
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      pending = null;
    },
  };
}

function createDrag(opt) {
  const o = Object.assign({
    sourceSelector: '.slot, .team-role-item',
    holdDelay: TOUCH_HOLD_DELAY,
    threshold: DRAG_THRESHOLD,
    bodyClass: 'pointer-dragging',
    onStart: null,
    onActivate: null,
    onMove: null,
    onBeforeEnd: null,
    onEnd: null,
    onCleanup: null,
  }, opt || {});

  // 拖拽上下文：每次 begin 重置通用字段，钩子可往上面挂自己的状态（如 targetIndex）
  const c = {
    pointerId: null,
    payload: null,
    isTouch: false,
    sx: 0, sy: 0,          // 按下位置
    x: 0, y: 0,            // 最近一次指针位置
    activated: false,
    holdTimer: null,
    ghost: null,
    sourceEl: null,
    _moveB: null, _endB: null, _noScrollB: null,
  };

  // 拖拽真正开始后才拦截 touchmove：激活之前不拦截，浏览器才能正常滚动面板
  function lockScroll() {
    if (c.isTouch) window.addEventListener('touchmove', c._noScrollB, { passive: false });
  }

  function unbind() {
    window.removeEventListener('pointermove', c._moveB);
    window.removeEventListener('pointerup', c._endB);
    window.removeEventListener('pointercancel', c._endB);
    if (c.isTouch) window.removeEventListener('touchmove', c._noScrollB, { passive: false });
  }

  // keepPayload：松手时「先清理再落位」的落位钩子仍可能需要读 c.payload
  // （页面3 的 bossDragInfo 就要靠它区分 new-team / move），故此时延后到落位之后再置空。
  function cleanup(keepPayload) {
    unbind();
    if (c.holdTimer) { clearTimeout(c.holdTimer); c.holdTimer = null; }
    document.body.classList.remove(o.bodyClass);
    if (c.ghost) { c.ghost.remove(); c.ghost = null; }
    if (c.sourceEl) c.sourceEl.classList.remove('drag-sourcing');
    if (o.onCleanup) o.onCleanup(c);
    c.pointerId = null; c.sourceEl = null; c.activated = false;
    if (!keepPayload) c.payload = null;
  }

  function activate(x, y) {
    if (!c.sourceEl) return;
    c.activated = true;
    document.body.classList.add(o.bodyClass);
    if (o.onActivate) o.onActivate(c, x, y);
    lockScroll();
    if (o.onMove) o.onMove(c, x, y);
  }

  function move(e) {
    if (e.pointerId !== c.pointerId) return;
    const dx = e.clientX - c.sx, dy = e.clientY - c.sy;
    c.x = e.clientX; c.y = e.clientY;
    if (c.activated) {
      if (o.onMove) o.onMove(c, e.clientX, e.clientY);
      return;
    }
    if (c.isTouch) {
      // 触屏未激活：位移过大判定为“滚动” → 取消拖拽，把滚动交还给浏览器
      if (c.holdTimer && Math.hypot(dx, dy) > TOUCH_SCROLL_CANCEL) {
        clearTimeout(c.holdTimer); c.holdTimer = null;
        cleanup();
      }
      return;
    }
    if (Math.hypot(dx, dy) < o.threshold) return;
    activate(c.sx + dx, c.sy + dy);
  }

  function end(e) {
    if (e.pointerId !== c.pointerId) return;
    const activated = c.activated;
    const payload = c.payload;
    const x = e.clientX, y = e.clientY;
    if (o.onBeforeEnd) o.onBeforeEnd(c); // 拉伸：把 rAF 里最后一帧落位
    cleanup(true);                        // 保留 c.payload：落位钩子可能还要读它
    if (activated && o.onEnd) o.onEnd(c, payload, x, y);
    c.payload = null;                     // 落位结束后才真正清空
    // 注意：清理时不要重置调用方自己的字段（如 BossDrag 的 reuseRound / TeamDrag 的 targetIndex）。
    // 松手流程是「先清理再落位」，提前清空会让落位判断读到空值；各 begin 开头都会重新赋值。
  }

  function begin(e, payload, isTouch) {
    if (c.pointerId != null) cleanup(); // 多指同时按下：先收掉上一次，避免监听器叠加
    c.pointerId = e.pointerId;
    c.payload = payload;
    c.isTouch = !!isTouch;
    c.sx = e.clientX; c.sy = e.clientY; c.x = c.sx; c.y = c.sy;
    c.activated = false; c.ghost = null;
    c.sourceEl = (payload && payload.sourceEl)
      || (e.target && e.target.closest ? e.target.closest(o.sourceSelector) : null);
    c._moveB = move; c._endB = end;
    c._noScrollB = ev => ev.preventDefault();
    window.addEventListener('pointermove', c._moveB);
    window.addEventListener('pointerup', c._endB);
    window.addEventListener('pointercancel', c._endB);

    // 触屏：长按 holdDelay 未滚动即启用拖拽；鼠标：靠位移阈值即时启用
    if (c.isTouch) {
      c.holdTimer = setTimeout(() => {
        c.holdTimer = null;
        if (!c.activated) activate(c.sx, c.sy);
      }, o.holdDelay);
    }
  }

  // 立即生效的拖拽（目前只有“拉伸边缘”）：不判阈值、不等长按，按下就开始
  function beginNow(e, payload) {
    if (c.pointerId != null) cleanup();
    c.pointerId = e.pointerId;
    c.payload = payload;
    c.isTouch = e.pointerType !== 'mouse';
    c.sx = e.clientX; c.sy = e.clientY; c.x = c.sx; c.y = c.sy;
    c.activated = true; c.ghost = null;
    c.sourceEl = (payload && payload.sourceEl) || e.currentTarget || null;
    c._moveB = move; c._endB = end;
    c._noScrollB = ev => ev.preventDefault();
    document.body.classList.add(o.bodyClass);
    if (o.onStart) o.onStart(c, e);
    lockScroll();
    window.addEventListener('pointermove', c._moveB);
    window.addEventListener('pointerup', c._endB);
    window.addEventListener('pointercancel', c._endB);
  }

  return {
    ctx: c,
    begin,
    beginNow,
    cancel: cleanup,
    isDragging: () => c.pointerId != null,
  };
}

// ================= 拖回左面板时的高亮遮罩 =================
// 用固定定位的独立元素绘制，确保绿色虚线/填充位于面板内队伍块与头像之上。
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
