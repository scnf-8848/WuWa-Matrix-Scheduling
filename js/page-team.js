// ================= 页面2：配队 =================
// 左：角色池（只显示已持有）；右：队伍网格（每队 3 个槽位，可拖拽排序）

// 该角色还剩几次可用：基础次数 + 额外疲劳 - 已被放进队伍的次数
function getRemainingUses(char) {
  const used = teams.flatMap(team => team.slots).filter(slot => slot && slot.id === char.id).length;
  const total = char.totalUses + (extraUseChars.has(char.id) ? 1 : 0);
  return Math.max(0, total - used);
}

function renderTeamIfVisible() {
  const page = document.getElementById('teamPage');
  if (page && !page.classList.contains('hidden')) renderTeamPage();
}

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

// 落位：character = 从角色池拖入 / slot = 槽位之间搬运或互换
function handleDrop(targetTeamIndex, targetSlotIndex, type, source) {
  const team = teams[targetTeamIndex];
  if (!team) return;
  if (type === 'character') {
    const char = charById.get(source.id);
    if (!char) return;
    // 同一支队伍里不能出现同一个角色两次；剩余次数为 0 也不能再放。
    // （拖回「自己原来所在的那个槽」同样被这条拦住 —— 它本来就该拦，不必为此留特例。）
    const teamHasChar = team.slots.some(s => s && s.id === char.id);
    if (getRemainingUses(char) > 0 && !teamHasChar) {
      commit(() => { team.slots[targetSlotIndex] = { id: char.id }; }, renderTeamPage);
    }
    return;
  }
  if (type !== 'slot') return;
  const [fromTeam, fromSlot] = source.index;
  if (fromTeam === targetTeamIndex && fromSlot === targetSlotIndex) return; // 原地松手，不做无意义的交换
  const fromChar = teams[fromTeam].slots[fromSlot];
  if (!fromChar) return;
  const dstChar = team.slots[targetSlotIndex];
  // 目标队里不能已经有被拖的角色。同队内互换时，源槽里的就是这个角色，必须排除「源槽」而不是「目标槽」，
  // 否则同队互换会被误判为重复。
  const dupInTarget = teams[targetTeamIndex].slots.some((s, i) =>
    s && s.id === fromChar.id && !(fromTeam === targetTeamIndex && i === fromSlot));
  if (dupInTarget) return;
  // 跨队交换：源队里也不能已经有「目标槽那个角色」，否则交换后源队会出现同一角色两份
  // （如 A=[X,Y,Z] 把 Y 拖到 B 的 Z 上 → 不做这条校验会得到 A=[X,Z,Z]）
  if (fromTeam !== targetTeamIndex && dstChar &&
      teams[fromTeam].slots.some((s, i) => s && s.id === dstChar.id && i !== fromSlot)) return;
  commit(() => {
    teams[fromTeam].slots[fromSlot] = dstChar;
    team.slots[targetSlotIndex] = fromChar;
  }, renderTeamPage);
}

// ===== 拖拽一：角色池 / 槽位 → 槽位 =====
// 角色项被拖拽激活后抑制随后的 click（避免拖回原处松手误触发“添加”）
let suppressCharacterClick = false;

const PointerDrag = createDrag({
  sourceSelector: '.slot, .team-role-item',

  onActivate(c) {
    if (c.payload.type === 'character') suppressCharacterClick = true;
    if (c.sourceEl) c.sourceEl.classList.add('drag-sourcing');
    c.ghost = makeGhostFrom(c.sourceEl);
  },

  onMove(c, x, y) {
    // 幽灵跟随指针（以指针为中心，与源元素视觉尺寸一致）
    if (c.ghost) {
      const r = c.ghost.getBoundingClientRect();
      c.ghost.style.left = (x - r.width / 2) + 'px';
      c.ghost.style.top = (y - r.height / 2) + 'px';
    }
    document.querySelectorAll('.slot.drag-target').forEach(s => s.classList.remove('drag-target'));
    setReleaseHoverOverlay(null, false);
    const el = document.elementFromPoint(x, y);
    if (el && el.closest('.slot')) {
      el.closest('.slot').classList.add('drag-target');
    } else if (c.payload.type === 'slot' && el && el.closest('.left-panel')) {
      // 槽位拖到左面板 → 提示可释放回角色池
      setReleaseHoverOverlay(el.closest('.left-panel'), true);
    }
  },

  onEnd(c, payload, x, y) {
    const el = document.elementFromPoint(x, y);
    if (payload.type === 'slot') {
      // 拖到队伍槽 → 换位/搬移；拖到左面板整体 → 释放回角色池
      const slot = el && el.closest('.slot');
      if (slot && slot.dataset.index) {
        const ds = slot.dataset.index.split(',').map(Number);
        handleDrop(ds[0], ds[1], 'slot', payload.source);
      } else if (el && el.closest('.left-panel')) {
        const [fromTeam, fromSlot] = payload.source.index;
        commit(() => { teams[fromTeam].slots[fromSlot] = null; }, renderTeamPage);
      }
    } else if (payload.type === 'character') {
      const slot = el && el.closest('.slot');
      if (slot && slot.dataset.index) {
        const ds = slot.dataset.index.split(',').map(Number);
        handleDrop(ds[0], ds[1], 'character', payload.source);
      }
    }
  },

  onCleanup() {
    document.querySelectorAll('.slot.drag-target').forEach(s => s.classList.remove('drag-target'));
    setReleaseHoverOverlay(null, false);
  },
});

// source 允许传函数：keyed 渲染会复用节点，源数据（角色/槽位下标）必须在按下时现取
function setupPointerDrag(el, type, source) {
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (el.classList.contains('not-available')) return; // 可用次数为 0：不可拖
    const src = typeof source === 'function' ? source() : source;
    if (!src) return; // 槽位已空 / 数据已失效：不作为拖源
    suppressCharacterClick = false;
    PointerDrag.begin(e, { type, source: src }, e.pointerType !== 'mouse');
  });
}

// ===== 拖拽二：队伍整行排序 =====
// 自定义实现以精确控制「目标落位」：落位按网格的「列 × 行」计算，
// 避免把「左列最后一行」错判成「右列第一行」。
const TeamDrag = createDrag({
  sourceSelector: '.team-row',

  onActivate(c, x, y) {
    const el = c.sourceEl;
    const r = el.getBoundingClientRect();
    // 抓取点相对幽灵左上角的像素偏移：幽灵与落位一致，避免瞬移
    c.grabPx = Math.min(Math.max(x - r.left, 0), r.width);
    c.grabPy = Math.min(Math.max(y - r.top, 0), r.height);
    c.w = r.width; c.h = r.height;
    c.ghost = makeGhostFrom(el);
    c.ghost.style.width = `${r.width}px`;
    c.ghost.style.height = `${r.height}px`;
    // 源行移出网格流（display:none），其它队伍实时重排
    el.style.display = 'none';
    // 目标落位：空白块 + 绿色虚线描边；作为网格项插入，自动把其它队伍挤开
    const ph = document.createElement('div');
    ph.className = 'team-row-placeholder';
    document.getElementById('teamSection').appendChild(ph);
    c.placeholder = ph;
  },

  onMove(c, x, y) {
    if (c.ghost) {
      c.ghost.style.left = `${x - c.grabPx}px`;
      c.ghost.style.top = `${y - c.grabPy}px`;
    }
    teamDragUpdatePlaceholder(c, x, y);
  },

  onEnd(c, payload) {
    // 行节点会被复用、队伍也会被删/调序：按 id 现查下标，不用渲染时捕获的 teamIndex
    const from = teams.findIndex(t => t.id === payload.teamId);
    const to = c.targetIndex;
    if (to != null && from >= 0 && to !== from && to < teams.length) {
      commit(() => {
        const moved = teams[from];
        teams.splice(from, 1);
        teams.splice(to, 0, moved);
      }, renderTeamPage);
    }
  },

  onCleanup(c) {
    if (c.sourceEl) c.sourceEl.style.display = '';
    if (c.placeholder) { c.placeholder.remove(); c.placeholder = null; }
  },
});

// 计算目标落位下标：最近列 + 最近行 → 列优先线性下标
function teamDragTargetIndex(c, cx, cy) {
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
  const colW = cols[0] || c.w;
  const perCol = Math.max(1, rows.length);   // 每列行数（由 updateLayoutScale 写入）
  const rowH = rows[0] || c.h;
  const n = teams.length;

  // 各列容量：末列可能未填满（列优先填充）
  const cap = [];
  for (let k = 0; k < numCols; k++) {
    cap[k] = (k < numCols - 1) ? perCol : Math.max(0, n - (numCols - 1) * perCol);
  }
  // 选择水平方向最近、且仍有容量的列
  // justify-content:center（单列收窄后居中）时所有列整体右移，落位计算要补上这段偏移
  const tracksW = cols.reduce((a, b) => a + b, 0) + (numCols - 1) * colGap;
  const hFree = section.clientWidth - padL - (parseFloat(cs.paddingRight) || 0) - tracksW;
  const hOff = (cs.justifyContent === 'center' && hFree > 0) ? hFree / 2 : 0;
  let col = 0, best = Infinity;
  for (let k = 0; k < numCols; k++) {
    if (cap[k] <= 0) continue;
    const centerX = r.left + padL + hOff + k * (colW + colGap) + colW / 2;
    const d = Math.abs(cx - centerX);
    if (d < best) { best = d; col = k; }
  }
  // 行：按行高+行距取最近行，再按该列容量钳制
  // alignContent:center 时网格内容整体下移，落位计算要补上这段偏移
  const contentH = rowH * rows.length + rowGap * Math.max(0, rows.length - 1);
  const free = section.clientHeight - padT - (parseFloat(cs.paddingBottom) || 0) - contentH;
  const vOff = (cs.alignContent === 'center' && free > 0) ? free / 2 : 0;
  let row = Math.round((cy - (r.top + padT + vOff + rowH / 2)) / (rowH + rowGap));
  row = Math.min(Math.max(row, 0), Math.max(0, cap[col] - 1));

  return Math.min(Math.max(col * perCol + row, 0), n - 1);
}

function teamDragUpdatePlaceholder(c, cx, cy) {
  if (!c.placeholder) return;
  const index = teamDragTargetIndex(c, cx, cy);
  c.targetIndex = index;
  // 插入到当前第 index 个队伍之前 → 网格中占据该单元，其后队伍整体后移
  const section = document.getElementById('teamSection');
  const rows = Array.from(section.querySelectorAll('.team-row')).filter(el => el !== c.sourceEl);
  section.insertBefore(c.placeholder, rows[index] || null);
}

function setupTeamDrag(handleEl, rowEl) {
  handleEl.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    // 只带 id：行被复用后 dataset 里的 id 才是当前这次渲染的
    TeamDrag.begin(e, { teamId: Number(rowEl.dataset.teamId), sourceEl: rowEl }, e.pointerType !== 'mouse');
  });
}

// ===== 渲染 =====
// 角色池与队伍网格都走 keyed 渲染：落位后只更新变化的那几个节点，
// 不再整池重建（61 张头像重新解码、滚动位置丢失）。

function createTeamRoleItem(char) {
  const item = document.createElement('div');
  item.className = 'team-role-item';
  item.dataset.charId = char.id;
  item.innerHTML = `<img src="${getAvatar(char.name)}" alt="${char.name}" draggable="false"
    loading="lazy" decoding="async" onerror="handleImgError(this)">`;

  const nameOverlay = document.createElement('div');
  nameOverlay.className = 'name-overlay';
  item.appendChild(nameOverlay);

  const attr = document.createElement('div');
  attr.className = 'attr';          // 常驻、靠 display 控制（切换「显示链+武」不必重建）
  item.appendChild(attr);

  const uses = document.createElement('div');
  uses.className = 'uses';
  item.appendChild(uses);

  // 触屏长按 >220ms 或鼠标拖动后启用；id 现取，节点复用时不会指向旧角色
  setupPointerDrag(item, 'character', () => {
    const id = Number(item.dataset.charId);
    return charById.has(id) ? { id } : null;
  });

  item.addEventListener('click', () => {
    if (suppressCharacterClick) { suppressCharacterClick = false; return; } // 拖拽激活后的 click 忽略
    const char = charById.get(Number(item.dataset.charId));
    if (char) addCharToFirstFreeSlot(char);
  });
  return item;
}

function updateTeamRoleItem(item, char) {
  item.dataset.charId = char.id;
  const remaining = getRemainingUses(char);
  item.classList.toggle('not-available', remaining === 0);
  const img = item.querySelector('img');
  const src = getAvatar(char.name);
  if (img.getAttribute('src') !== src) { img.src = src; img.alt = char.name; }
  item.querySelector('.name-overlay').textContent = char.name;
  const attr = item.querySelector('.attr');
  attr.textContent = `${char.chain}+${char.weapon}`;
  attr.style.display = showAttr ? '' : 'none';
  const uses = item.querySelector('.uses');
  uses.className = extraUseChars.has(char.id) ? 'uses yellow' : `uses ${remaining > 0 ? 'green' : 'red'}`;
  uses.textContent = `${remaining}`;
}

// 点击角色池：放进第一支「还没有该角色、且有空格」的队伍
function addCharToFirstFreeSlot(char) {
  if (getRemainingUses(char) <= 0) return;
  for (let teamIndex = 0; teamIndex < teams.length; teamIndex++) {
    const team = teams[teamIndex];
    if (team.slots.some(slot => slot && slot.id === char.id)) continue;
    for (let slotIndex = 0; slotIndex < team.slots.length; slotIndex++) {
      if (team.slots[slotIndex] === null) {
        commit(() => { team.slots[slotIndex] = { id: char.id }; }, renderTeamPage);
        return;
      }
    }
  }
}

function renderTeamRoleList() {
  const list = document.getElementById('teamRoleList');
  renderEpoch(list);
  const owned = characters.filter(c => c.owned);
  reconcile(list, owned, c => c.id, createTeamRoleItem, updateTeamRoleItem);
}

// 一行队伍：把手 + 队名 + 删除 + 3 个槽位。节点只建一次，之后只更新内容。
function createTeamRow() {
  const row = document.createElement('div');
  row.className = 'team-row';

  const header = document.createElement('div');
  header.className = 'team-header';

  const handle = document.createElement('span');
  handle.className = 'team-handle';
  handle.textContent = '☰';
  setupTeamDrag(handle, row);

  const label = document.createElement('span');
  label.className = 'team-label';

  header.appendChild(handle);
  header.appendChild(label);
  row.appendChild(header);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'delete-team-btn';
  del.textContent = '×';
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    if (teams.length <= 1) return; // 至少保留 1 支队伍（与布局的不变量一致）
    const teamId = Number(row.dataset.teamId);
    commit(() => { teams.splice(teams.findIndex(t => t.id === teamId), 1); }, renderTeamPage);
  });
  row.appendChild(del);

  const slots = document.createElement('div');
  slots.className = 'team-slots';
  for (let i = 0; i < 3; i++) {
    const slotDiv = document.createElement('div');
    slotDiv.className = 'slot';
    // 有角色的槽位才是拖源：源数据在按下时从 dataset 现取（行会被复用/调序）
    slotDiv.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!slotDiv.dataset.charId) return;
      const [t, s] = slotDiv.dataset.index.split(',').map(Number);
      suppressCharacterClick = false;
      PointerDrag.begin(e, { type: 'slot', source: { index: [t, s] } }, e.pointerType !== 'mouse');
    });
    slots.appendChild(slotDiv);
  }
  row.appendChild(slots);
  return row;
}

// 只在槽位里的角色变化时重建内部节点（img / 角标 / 删除按钮），其余情况只改文字
function updateTeamSlot(slotDiv, teamIndex, slotIndex, slot) {
  slotDiv.dataset.index = `${teamIndex},${slotIndex}`;
  // 槽位只存角色 id：名字与链/武都在角色表里查（换译名不会影响队伍）
  const char = slot ? charById.get(slot.id) : null;
  const key = char ? String(char.id) : '';
  if (slotDiv.dataset.charId === key) {
    if (char) {
      const attr = slotDiv.querySelector('.attr');
      if (attr) {
        attr.textContent = `${char.chain}+${char.weapon}`;
        attr.style.display = showAttr ? '' : 'none';
      }
    }
    return;
  }
  slotDiv.dataset.charId = key;
  Array.from(slotDiv.children).forEach(n => n.remove());
  if (!char) return;

  const img = document.createElement('img');
  img.src = getAvatar(char.name);
  img.alt = char.name;
  img.draggable = false;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.onerror = function () { handleImgError(this); };
  slotDiv.appendChild(img);

  const attr = document.createElement('div');
  attr.className = 'attr';
  attr.textContent = `${char.chain}+${char.weapon}`;
  attr.style.display = showAttr ? '' : 'none';
  slotDiv.appendChild(attr);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'delete-btn';
  deleteBtn.textContent = '×';
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // 下标现取：队伍顺序可能已经变过
    const [t, s] = slotDiv.dataset.index.split(',').map(Number);
    const team = teams[t];
    if (team) commit(() => { team.slots[s] = null; }, renderTeamPage);
  });
  slotDiv.appendChild(deleteBtn);
}

function updateTeamRow(row, team) {
  const teamIndex = teams.indexOf(team);
  row.dataset.teamId = team.id;
  row.querySelector('.team-label').textContent = `队伍${teamIndex + 1}`;
  const slotDivs = row.querySelectorAll('.slot');
  for (let i = 0; i < slotDivs.length; i++) {
    updateTeamSlot(slotDivs[i], teamIndex, i, team.slots[i] || null);
  }
}

// 渲染队伍
function renderTeams() {
  const section = document.getElementById('teamSection');
  renderEpoch(section);
  reconcile(section, teams, t => t.id, createTeamRow, updateTeamRow);

  // 添加队伍按钮（放到底部工具行）
  const addTeamBtn = document.createElement('button');
  addTeamBtn.className = 'add-team-btn';
  addTeamBtn.textContent = '添加队伍';
  addTeamBtn.addEventListener('click', () => {
    commit(() => { teams.push({ id: nextTeamId(), slots: [null, null, null] }); }, renderTeamPage);
  });
  const footer = document.querySelector('.team-footer');
  const oldAddBtn = footer.querySelector('.add-team-btn');
  if (oldAddBtn) oldAddBtn.remove();
  footer.insertBefore(addTeamBtn, footer.firstChild);

  updateLayoutScale();
}
