// ================= 页面1：角色 =================

// 底部状态码条：分享码由链/武/持有/额外疲劳共同决定，任何一处变动都要同步
function updateStatusCodeBar() {
  const statusBar = document.getElementById('leftStatusBar');
  const statusCodeEl = document.getElementById('leftStatusCode');
  if (!statusBar || !statusCodeEl) return;
  if (meta.currentUid != null) {
    statusCodeEl.textContent = encodeUserState(meta.currentUid);
    statusBar.style.display = 'flex';
  } else {
    statusBar.style.display = 'none';
  }
}

// 角色在数组中的下标（characters 顺序 = characters.js 的书写顺序，一般不会变）
function charIndexById(id) {
  for (let i = 0; i < characters.length; i++) if (characters[i].id === id) return i;
  return -1;
}

// 只刷新一个角色的「链+武」角标，而不是重建整张列表。点链/武是最频繁的交互。
function refreshRoleItem(index) {
  updateStatusCodeBar();
  const item = document.querySelector(`#roleList .role-item[data-index="${index}"]`);
  const char = characters[index];
  if (!item || !char) return;
  const attr = item.querySelector('.attr');
  if (!attr) return;
  attr.textContent = `${char.chain}+${char.weapon}`;
  attr.style.display = showAttr ? '' : 'none';
}

// 分区（已持有 / 未持有）只建一次，角色节点靠 keyed 渲染复用
function buildRoleSection(part, title, btnText, onBtn) {
  const section = document.createElement('div');
  section.className = 'role-section';
  section.dataset.part = part;
  section.innerHTML = `<div class="section-header"><h3>${title}</h3><button class="section-btn">${btnText}</button></div><div class="role-list"></div>`;
  section.querySelector('.section-btn').addEventListener('click', onBtn);
  return section;
}

function createRoleItem(char) {
  const item = document.createElement('div');
  item.className = 'role-item';
  item.dataset.charId = char.id;
  item.innerHTML = `<img src="${getAvatar(char.name)}" alt="${char.name}" draggable="false"
    loading="lazy" decoding="async" onerror="handleImgError(this)">`;

  const nameOverlay = document.createElement('div');
  nameOverlay.className = 'name-overlay';
  item.appendChild(nameOverlay);

  // 角标与「+1」徽标都常驻，靠 display 控制显隐：切换时不必重建节点
  const attr = document.createElement('div');
  attr.className = 'attr';
  item.appendChild(attr);

  const statusBtn = document.createElement('button');
  statusBtn.type = 'button';
  statusBtn.className = 'status-btn';
  statusBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // 节点会被复用，处理器里不能捕获某一次渲染的角色对象 —— 按 id 现查
    const i = charIndexById(Number(item.dataset.charId));
    if (i >= 0) setCharOwned(i, !characters[i].owned);
  });
  item.appendChild(statusBtn);

  const badge = document.createElement('div');
  badge.className = 'uses yellow';
  badge.textContent = '+1';
  item.appendChild(badge);

  item.addEventListener('click', () => {
    const i = charIndexById(Number(item.dataset.charId));
    if (i >= 0) showRoleDetail(i);
  });
  return item;
}

function updateRoleItem(item, char) {
  item.dataset.charId = char.id;
  item.dataset.index = charIndexById(char.id); // 供 updateChain / updateWeapon 做局部刷新
  const img = item.querySelector('img');
  const src = getAvatar(char.name);
  if (img.getAttribute('src') !== src) { img.src = src; img.alt = char.name; }
  item.querySelector('.name-overlay').textContent = char.name;
  const attr = item.querySelector('.attr');
  attr.textContent = `${char.chain}+${char.weapon}`;
  attr.style.display = showAttr ? '' : 'none';
  const btn = item.querySelector('.status-btn');
  btn.className = `status-btn ${char.owned ? 'remove' : ''}`;
  btn.textContent = char.owned ? '×' : '↑';
  item.querySelector('.uses.yellow').style.display = extraUseChars.has(char.id) ? '' : 'none';
}

function renderRoleList() {
  const list = document.getElementById('roleList');
  updateStatusCodeBar();

  if (meta.currentUid == null) {
    list.innerHTML = '';
    list.dataset.epoch = String(dataEpoch); // 空态也记世代：切回用户时才知道要重建
    list.appendChild(emptyHint());
    return;
  }

  if (renderEpoch(list)) {
    list.appendChild(buildRoleSection('owned', '已持有', '全部没有', openClearOwned));
    list.appendChild(buildRoleSection('not-owned', '未持有', '全部持有', acquireAllChars));
  }

  const ownedList = list.querySelector('[data-part="owned"] .role-list');
  const otherList = list.querySelector('[data-part="not-owned"] .role-list');
  const owned = [];
  const others = [];
  characters.forEach(c => (c.owned ? owned : others).push(c));

  // 两个分区共用同一个节点池：切换持有时节点整块搬家，不重建（图片不重新解码）
  const pool = new Map();
  list.querySelectorAll('.role-item').forEach(n => pool.set(n.dataset.key, n));
  const used = new Set();
  reconcile(ownedList, owned, c => c.id, createRoleItem, updateRoleItem, pool)
    .forEach(k => used.add(k));
  reconcile(otherList, others, c => c.id, createRoleItem, updateRoleItem, pool)
    .forEach(k => used.add(k));
  pool.forEach((node, key) => { if (!used.has(key)) node.remove(); });
}

// 批量改状态后让右侧详情与列表同源（详情只在点击角色时重绘，否则会停在旧快照上）
function refreshDetailIfSelected() {
  if (currentSelectedRoleIndex != null && characters[currentSelectedRoleIndex]) {
    showRoleDetail(currentSelectedRoleIndex);
  }
}

function showRoleDetail(index) {
  currentSelectedRoleIndex = index;
  const char = characters[index];
  const detail = document.getElementById('roleDetail');

  let chainButtons = '';
  for (let i = 0; i <= CHAIN_MAX; i++) {
    chainButtons += `<button class="attr-btn ${char.chain === i ? 'active' : ''}" onclick="updateChain(${index}, ${i})"><strong>${i}</strong></button>`;
  }

  let weaponButtons = '';
  for (let i = 0; i <= WEAPON_MAX; i++) {
    weaponButtons += `<button class="attr-btn ${char.weapon === i ? 'active' : ''}" onclick="updateWeapon(${index}, ${i})"><strong>${i}</strong></button>`;
  }

  detail.innerHTML = `
    <img src="${getAvatar(char.name)}" alt="${char.name}" decoding="async" onerror="handleImgError(this)">
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
      <input type="checkbox" id="extraUseCheckbox" ${extraUseChars.has(char.id) ? 'checked' : ''} onchange="toggleExtraUse(${index})">
    </div>
  `;
}

// 持有状态切换的唯一入口。
// 「未持有的角色不能占着队伍槽位」这条规则不写在这里：normalizeState 是 commit 的固定一步，
// 会统一清掉槽位里未持有的角色（见 store.js）。将来新增第五条写入路径也不会漏。
// 额外疲劳（extraUseChars）按设计保留：未持有期间仍显示 +1，重新持有后继续生效。
function setCharOwned(index, owned) {
  const char = characters[index];
  if (!char) return;
  commit(() => { char.owned = !!owned; }, () => {
    renderRoleList();
    renderTeamIfVisible();
    refreshDetailIfSelected();
  });
}

// 「全部没有」：清空全部持有状态不可撤销（队伍槽位会被一并清空），先确认再执行
function openClearOwned() { showModal('clearOwnedModal'); }
function confirmClearOwned() {
  hideModal('clearOwnedModal');
  commit(() => { characters.forEach(char => { char.owned = false; }); }, () => {
    renderRoleList();
    refreshDetailIfSelected();
    renderTeamIfVisible();
  });
}

// 「全部持有」
function acquireAllChars() {
  commit(() => { characters.forEach(char => { char.owned = true; }); }, () => {
    renderRoleList();
    refreshDetailIfSelected();
    renderTeamIfVisible();
  });
}

// 改链/改武只刷新该角色的角标（不重建列表），必要时同步队伍页与右侧详情
function updateChain(index, value) {
  commit(() => { characters[index].chain = clampInt(value, 0, CHAIN_MAX, 0); }, () => {
    refreshRoleItem(index);
    renderTeamIfVisible();
    if (currentSelectedRoleIndex === index) showRoleDetail(index);
  });
}
function updateWeapon(index, value) {
  commit(() => { characters[index].weapon = clampInt(value, 0, WEAPON_MAX, 0); }, () => {
    refreshRoleItem(index);
    renderTeamIfVisible();
    if (currentSelectedRoleIndex === index) showRoleDetail(index);
  });
}

function toggleExtraUse(index) {
  const char = characters[index];
  const isChecked = document.getElementById('extraUseCheckbox').checked;

  commit(() => {
    if (isChecked) {
      extraUseChars.add(char.id);
      return;
    }
    if (!extraUseChars.delete(char.id)) return;
    // 取消额外疲劳后总次数减少：多占的槽位（从后往前）要一并摘掉，否则该角色会超出上限
    const used = teams.flatMap(team => team.slots).filter(slot => slot && slot.id === char.id).length;
    if (used > char.totalUses) {
      for (let i = teams.length - 1; i >= 0; i--) {
        let removed = false;
        for (let j = teams[i].slots.length - 1; j >= 0; j--) {
          if (teams[i].slots[j] && teams[i].slots[j].id === char.id) {
            teams[i].slots[j] = null;
            removed = true;
            break;
          }
        }
        if (removed) break;
      }
    }
  }, () => {
    renderRoleList();
    renderTeamIfVisible();
    if (currentSelectedRoleIndex === index) showRoleDetail(index);
  });
}
