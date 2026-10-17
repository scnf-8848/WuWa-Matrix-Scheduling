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

// 只刷新一个角色的「链+武」角标，而不是重建整张列表（61 个节点 + 61 张图）。
// 点链/武按钮是最频繁的交互，全量重建会让每次点击都丢一次滚动位置和图片解码。
function refreshRoleItem(index) {
  updateStatusCodeBar();
  if (!showAttr) return;
  const item = document.querySelector(`#roleList .role-item[data-index="${index}"]`);
  const char = characters[index];
  if (!item || !char) return;
  const attr = item.querySelector('.attr');
  if (attr) attr.textContent = `${char.chain}+${char.weapon}`;
}

function renderRoleList() {
  const list = document.getElementById('roleList');
  list.innerHTML = '';

  // 底部状态码条：随当前用户刷新，无用户时隐藏
  updateStatusCodeBar();

  if (meta.currentUid == null) { list.appendChild(emptyHint()); return; }

  const ownedSection = document.createElement('div');
  ownedSection.className = 'role-section';
  ownedSection.innerHTML = '<div class="section-header"><h3>已持有</h3><button class="section-btn">全部没有</button></div><div class="role-list"></div>';

  const notOwnedSection = document.createElement('div');
  notOwnedSection.className = 'role-section';
  notOwnedSection.innerHTML = '<div class="section-header"><h3>未持有</h3><button class="section-btn">全部持有</button></div><div class="role-list"></div>';

  notOwnedSection.querySelector('.section-btn').addEventListener('click', () => {
    commit(() => { characters.forEach(char => { char.owned = true; }); }, () => {
      renderRoleList();
      refreshDetailIfSelected();
      renderTeamIfVisible();
    });
  });

  ownedSection.querySelector('.section-btn').addEventListener('click', () => {
    commit(() => {
      characters.forEach(char => { char.owned = false; });
      teams.forEach(team => { team.slots = [null, null, null]; });
    }, () => {
      renderRoleList();
      refreshDetailIfSelected();
      renderTeamIfVisible();
    });
  });

  characters.forEach((char, index) => {
    const item = document.createElement('div');
    item.className = 'role-item';
    item.dataset.index = index; // 供 updateChain / updateWeapon 做局部刷新
    item.innerHTML = `<img src="${getAvatar(char.name)}" alt="${char.name}" draggable="false"
      loading="lazy" decoding="async" onerror="handleImgError(this)">`;

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
      setCharOwned(index, !char.owned);
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
  for (let i = 0; i <= 6; i++) {
    chainButtons += `<button class="attr-btn ${char.chain === i ? 'active' : ''}" onclick="updateChain(${index}, ${i})"><strong>${i}</strong></button>`;
  }

  let weaponButtons = '';
  for (let i = 0; i <= 5; i++) {
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
      <input type="checkbox" id="extraUseCheckbox" ${extraUseChars.includes(char.name) ? 'checked' : ''} onchange="toggleExtraUse(${index})">
    </div>
  `;
}

// 持有状态切换的唯一入口：状态按钮走这里，避免「取消持有时还要连带做什么」在多处各写一份。
// 目前要连带做的只有一件事：把该角色从所有队伍槽位里摘掉 ——
// 否则页面2 会留着一个角色池里已经没有的角色，用户无法用任何正常操作清掉它。
// 额外疲劳（extraUseChars）按设计保留：未持有期间仍显示 +1，重新持有后继续生效。
function setCharOwned(index, owned) {
  const char = characters[index];
  if (!char) return;
  commit(() => {
    char.owned = !!owned;
    if (!char.owned) {
      teams.forEach(team => {
        team.slots.forEach((slot, i) => {
          if (slot && slot.name === char.name) team.slots[i] = null;
        });
      });
    }
  }, () => {
    renderRoleList();
    renderTeamIfVisible();
    refreshDetailIfSelected();
  });
}

// 改链/改武只刷新该角色的角标（不重建列表），必要时同步队伍页与右侧详情
function updateChain(index, value) {
  commit(() => { characters[index].chain = parseInt(value, 10); }, () => {
    refreshRoleItem(index);
    renderTeamIfVisible();
    if (currentSelectedRoleIndex === index) showRoleDetail(index);
  });
}
function updateWeapon(index, value) {
  commit(() => { characters[index].weapon = parseInt(value, 10); }, () => {
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
      if (!extraUseChars.includes(char.name)) extraUseChars.push(char.name);
      return;
    }
    const idx = extraUseChars.indexOf(char.name);
    if (idx === -1) return;
    extraUseChars.splice(idx, 1);
    // 取消额外疲劳后总次数减少：多占的槽位（从后往前）要一并摘掉，否则该角色会超出上限
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
  }, () => {
    renderRoleList();
    renderTeamIfVisible();
    if (currentSelectedRoleIndex === index) showRoleDetail(index);
  });
}
