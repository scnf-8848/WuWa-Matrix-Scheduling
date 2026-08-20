// 图片扩展名回退列表（webp 优先）
const IMAGE_EXTENSIONS = ['webp', 'png', 'jpg', 'jpeg', 'gif'];

// 根据角色名生成头像路径
function getAvatar(name) {
  return `character/${name}.webp`;
}

// 图片加载失败时，按顺序尝试其他扩展名
function handleImgError(img) {
  const match = img.src.match(/^(.*)\.([^.]+)$/);
  if (!match) return;
  const basePath = match[1];
  const currentExt = match[2].toLowerCase();
  const currentIndex = IMAGE_EXTENSIONS.indexOf(currentExt);
  if (currentIndex >= 0 && currentIndex < IMAGE_EXTENSIONS.length - 1) {
    img.src = `${basePath}.${IMAGE_EXTENSIONS[currentIndex + 1]}`;
  }
}

// 用户角色数据（动态生成）
let characters = [];
let currentSelectedRoleIndex = null;

let teams = Array.from({ length: 3 }, () => ({ slots: [null, null, null] }));
let sortableInstance = null;
let showAttr = true;
let extraUseChars = [];
let currentUser = 1;

// 初始化角色数据
function initializeCharacters() {
  const savedUserData = localStorage.getItem(`userCharacterData_${currentUser}`);
  if (savedUserData) {
    const userData = JSON.parse(savedUserData);
    characters = characterTemplates.map((template) => {
      const userChar = userData[template.name] || { owned: false, chain: 0, weapon: 0 };
      return { ...template, avatar: getAvatar(template.name), ...userChar };
    });
  } else {
    characters = characterTemplates.map(template => ({
      ...template,
      avatar: getAvatar(template.name),
      owned: false,
      chain: 0,
      weapon: 0
    }));
  }
}

// 存读本地
function loadData() {
  initializeCharacters();

  const saved = localStorage.getItem(`gameScheduler_${currentUser}`);
  if (saved) {
    const data = JSON.parse(saved);
    if (data.teams) {
      teams = data.teams;
    } else {
      teams = Array.from({ length: 3 }, () => ({ slots: [null, null, null] }));
    }
    extraUseChars = data.extraUseChars || [];
  } else {
    teams = Array.from({ length: 3 }, () => ({ slots: [null, null, null] }));
    extraUseChars = [];
  }
}
function saveData() {
  const userData = {};
  characters.forEach(char => {
    userData[char.name] = {
      owned: char.owned,
      chain: char.chain,
      weapon: char.weapon
    };
  });
  localStorage.setItem(`userCharacterData_${currentUser}`, JSON.stringify(userData));
  localStorage.setItem(`gameScheduler_${currentUser}`, JSON.stringify({ teams, extraUseChars }));
  localStorage.setItem('currentUser', currentUser.toString());
}

// 清空所有数据
function clearAllData() {
  if (confirm('确定要清空所有用户数据吗？此操作将清除所有用户的角色和队伍数据，且无法恢复。')) {
    for (let i = 1; i <= 5; i++) {
      localStorage.removeItem(`userCharacterData_${i}`);
      localStorage.removeItem(`gameScheduler_${i}`);
    }
    localStorage.removeItem('currentUser');
    currentUser = 1;
    loadData();
    document.getElementById('userSelect').value = '1';
    showPage('role');
  }
}

// 导航
document.getElementById('roleBtn').addEventListener('click', () => showPage('role'));
document.getElementById('teamBtn').addEventListener('click', () => showPage('team'));
document.getElementById('clearBtn').addEventListener('click', clearAllData);

// 处理用户切换
document.getElementById('userSelect').addEventListener('change', function() {
  saveData();
  currentUser = parseInt(this.value, 10);
  localStorage.setItem('currentUser', currentUser.toString());
  currentSelectedRoleIndex = null;
  document.getElementById('roleDetail').innerHTML = '<p>请选择一个角色查看详情</p>';
  loadData();
  if (document.getElementById('rolePage').classList.contains('hidden')) {
    showPage('team');
  } else {
    showPage('role');
  }
});

// 处理显示/隐藏属性的切换
document.getElementById('attrToggle').addEventListener('change', function() {
  showAttr = this.checked;
  // 重新渲染当前页面
  if (document.getElementById('rolePage').classList.contains('hidden')) {
    renderTeamPage();
  } else {
    renderRoleList();
  }
});

// 计算网格行数与槽位尺寸，按行数自适应缩放，保证所有队伍一屏显示
function updateLayoutScale() {
  const section = document.getElementById('teamSection');
  const cs = getComputedStyle(section);
  const padTop = parseFloat(cs.paddingTop) || 0;
  const padBottom = parseFloat(cs.paddingBottom) || 0;
  const availH = section.clientHeight - padTop - padBottom;
  const n = teams.length;
  if (availH <= 0 || section.clientWidth <= 0) {
    section.style.setProperty('--slot-size', '46px');
    return;
  }

  const gap = 10;
  const naturalRow = 70;                                        // 队伍较少的自然行高（槽位 46 + 留白）
  const maxSlot = 46;
  const capPerCol = Math.max(1, Math.floor(availH / naturalRow)); // 一列内自然摆放的最大队伍数

  let perCol;    // 网格行数（每列最多数量）
  let size;      // 槽位尺寸
  let row;       // 行高

  if (n <= capPerCol) {
    // 数量少：全部堆在左列，右列留空
    perCol = Math.max(1, n);
    size = maxSlot;
    row = naturalRow;
  } else if (n <= capPerCol * 2) {
    // 左列填满后，余量进入右列；两列均能自然放下，无需缩放
    perCol = capPerCol;
    size = maxSlot;
    row = naturalRow;
  } else {
    // 超出两列自然容量：按列均分并缩小以适配一屏
    perCol = Math.ceil(n / 2);
    const budgetV = (availH - (perCol - 1) * gap) / perCol;
    size = Math.max(28, Math.min(maxSlot, budgetV - 24));
    row = size + 24;
  }

  section.style.setProperty('--slot-size', `${size}px`);
  // 显式声明网格，保障“左列优先填满再排右列”，且每列可收缩以防溢出
  section.style.gridTemplateRows = `repeat(${perCol}, ${row}px)`;
  section.style.gridTemplateColumns = 'minmax(0,1fr) minmax(0,1fr)';
  section.style.gridAutoFlow = 'column';
}

window.addEventListener('resize', function() {
  if (document.getElementById('teamPage').classList.contains('hidden')) return;
  updateLayoutScale();
});

function showPage(page) {
  document.getElementById('rolePage').classList.toggle('hidden', page !== 'role');
  document.getElementById('teamPage').classList.toggle('hidden', page !== 'team');
  if (page === 'role') renderRoleList();
  if (page === 'team') renderTeamPage();
}

// 角色页面渲染
function renderRoleList() {
  const list = document.getElementById('roleList');
  list.innerHTML = '';
  
  // 创建已持有区域
  const ownedSection = document.createElement('div');
  ownedSection.className = 'role-section';
  ownedSection.innerHTML = '<div class="section-header"><h3>已持有</h3><button class="section-btn">全部没有</button></div><div class="role-list"></div>';
  
  // 创建未持有区域
  const notOwnedSection = document.createElement('div');
  notOwnedSection.className = 'role-section';
  notOwnedSection.innerHTML = '<div class="section-header"><h3>未持有</h3><button class="section-btn">全部持有</button></div><div class="role-list"></div>';
  
  // 添加全部持有按钮事件
  notOwnedSection.querySelector('.section-btn').addEventListener('click', () => {
    characters.forEach(char => {
      char.owned = true;
    });
    saveData();
    renderRoleList();
    if (document.getElementById('teamPage').classList.contains('hidden') === false) renderTeamPage();
  });
  
  // 添加全部没有按钮事件
  ownedSection.querySelector('.section-btn').addEventListener('click', () => {
    characters.forEach(char => {
      char.owned = false;
    });
    
    // 从所有队伍中移除所有角色
    teams.forEach(team => {
      team.slots = [null, null, null];
    });
    
    saveData();
    renderRoleList();
    if (document.getElementById('teamPage').classList.contains('hidden') === false) renderTeamPage();
  });
  
  characters.forEach((char, index) => {
    const item = document.createElement('div');
    item.className = 'role-item';
    item.innerHTML = `<img src="${char.avatar}" alt="${char.name}" onerror="handleImgError(this)">`;

    const nameOverlay = document.createElement('div');
    nameOverlay.className = 'name-overlay';
    nameOverlay.textContent = char.name;
    item.appendChild(nameOverlay);

    // 添加属性显示
    if (showAttr) {
      const attr = document.createElement('div');
      attr.className = 'attr';
      attr.textContent = `${char.chain}+${char.weapon}`;
      item.appendChild(attr);
    }

    // 添加状态按钮
    const statusBtn = document.createElement('div');
    statusBtn.className = `status-btn ${char.owned ? 'remove' : ''}`;
    statusBtn.textContent = char.owned ? '×' : '↑';
    statusBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const newOwned = !char.owned;
      char.owned = newOwned;
      
      // 如果角色被取消持有，从所有队伍中移除该角色
      if (!newOwned) {
        teams.forEach(team => {
          team.slots.forEach((slot, slotIndex) => {
            if (slot && slot.name === char.name) {
              team.slots[slotIndex] = null;
            }
          });
        });
      }
      
      saveData();
      renderRoleList();
      if (document.getElementById('teamPage').classList.contains('hidden') === false) renderTeamPage();
    });
    item.appendChild(statusBtn);

    item.addEventListener('click', () => showRoleDetail(index));
    
    // 根据是否持有添加到不同区域
    if (char.owned) {
      ownedSection.querySelector('.role-list').appendChild(item);
    } else {
      notOwnedSection.querySelector('.role-list').appendChild(item);
    }
  });
  
  list.appendChild(ownedSection);
  list.appendChild(notOwnedSection);
}
function showRoleDetail(index) {
  currentSelectedRoleIndex = index;
  const char = characters[index];
  const detail = document.getElementById('roleDetail');
  
  // 生成共鸣链按钮
  let chainButtons = '';
  for (let i = 0; i <= 6; i++) {
    chainButtons += `<button class="attr-btn ${char.chain === i ? 'active' : ''}" onclick="updateChain(${index}, ${i})"><strong>${i}</strong></button>`;
  }
  
  // 生成专武按钮
  let weaponButtons = '';
  for (let i = 0; i <= 5; i++) {
    weaponButtons += `<button class="attr-btn ${char.weapon === i ? 'active' : ''}" onclick="updateWeapon(${index}, ${i})"><strong>${i}</strong></button>`;
  }
  
  detail.innerHTML = `
    <img src="${char.avatar}" alt="${char.name}" onerror="handleImgError(this)">
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
function toggleOwned(index, owned) {
  const char = characters[index];
  char.owned = owned;
  
  // 如果角色被取消持有，从所有队伍中移除该角色
  if (!owned) {
    teams.forEach(team => {
      team.slots.forEach((slot, slotIndex) => {
        if (slot && slot.name === char.name) {
          team.slots[slotIndex] = null;
        }
      });
    });
  }
  
  saveData();
  renderRoleList();
  if (document.getElementById('teamPage').classList.contains('hidden') === false) renderTeamPage();
}
function updateChain(index, value) {
  characters[index].chain = parseInt(value, 10);
  saveData();
  renderRoleList();
  if (document.getElementById('teamPage').classList.contains('hidden') === false) renderTeamPage();
  // 如果当前选中的角色就是被更新的角色，重新渲染属性面板
  if (currentSelectedRoleIndex === index) {
    showRoleDetail(index);
  }
}
function updateWeapon(index, value) {
  characters[index].weapon = parseInt(value, 10);
  saveData();
  renderRoleList();
  if (document.getElementById('teamPage').classList.contains('hidden') === false) renderTeamPage();
  // 如果当前选中的角色就是被更新的角色，重新渲染属性面板
  if (currentSelectedRoleIndex === index) {
    showRoleDetail(index);
  }
}

function toggleExtraUse(index) {
  const char = characters[index];
  const isChecked = document.getElementById('extraUseCheckbox').checked;
  
  if (isChecked) {
    if (!extraUseChars.includes(char.name)) {
      extraUseChars.push(char.name);
    }
  } else {
    const idx = extraUseChars.indexOf(char.name);
    if (idx !== -1) {
      extraUseChars.splice(idx, 1);
      
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
    }
  }
  
  saveData();
  renderRoleList();
  if (document.getElementById('teamPage').classList.contains('hidden') === false) renderTeamPage();
  if (currentSelectedRoleIndex === index) {
    showRoleDetail(index);
  }
}

function getRemainingUses(char) {
  const used = teams.flatMap(team => team.slots).filter(slot => slot && slot.name === char.name).length;
  const total = char.totalUses + (extraUseChars.includes(char.name) ? 1 : 0);
  return Math.max(0, total - used);
}

// 队伍页面渲染
function renderTeamPage() {
  renderTeamRoleList();
  renderTeams();
}

// 左侧角色池
function renderTeamRoleList() {
  const list = document.getElementById('teamRoleList');
  list.innerHTML = '';
  
  characters.forEach((char, index) => {
    if (!char.owned) return;
    const remaining = getRemainingUses(char);
    const item = document.createElement('div');
    item.className = 'team-role-item';
    if (remaining === 0) item.classList.add('not-available');
    item.draggable = remaining > 0;
    item.innerHTML = `<img src="${char.avatar}" alt="${char.name}" onerror="handleImgError(this)">`;

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

    const uses = document.createElement('div');
    if (extraUseChars.includes(char.name)) {
      uses.className = 'uses yellow';
    } else {
      uses.className = `uses ${remaining > 0 ? 'green' : 'red'}`;
    }
    uses.textContent = `${remaining}`;
    item.appendChild(uses);

    item.addEventListener('dragstart', (e) => {
      const currentRemaining = getRemainingUses(char);
      if (currentRemaining <= 0) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'character', name: char.name }));
    });

    item.addEventListener('dragover', (e) => e.preventDefault());

    // 添加点击事件，实现点击角色自动添加到队伍
    item.addEventListener('click', () => {
      const currentRemaining = getRemainingUses(char);
      if (currentRemaining <= 0) {
        return;
      }
      
      // 寻找第一个空槽位
      let foundSlot = false;
      for (let teamIndex = 0; teamIndex < teams.length; teamIndex++) {
        const team = teams[teamIndex];
        // 检查队伍中是否已存在该角色
        const teamHasChar = team.slots.some(slot => slot && slot.name === char.name);
        if (teamHasChar) {
          continue;
        }
        
        for (let slotIndex = 0; slotIndex < team.slots.length; slotIndex++) {
          if (team.slots[slotIndex] === null) {
            // 找到空槽位，添加角色
            team.slots[slotIndex] = { name: char.name };
            foundSlot = true;
            break;
          }
        }
        if (foundSlot) {
          break;
        }
      }
      
      if (foundSlot) {
        saveData();
        renderTeamPage();
      }
    });

    list.appendChild(item);
  });
}

// 渲染队伍
function renderTeams() {
  const section = document.getElementById('teamSection');
  section.innerHTML = '';

  teams.forEach((team, teamIndex) => {
    const row = document.createElement('div');
    row.className = 'team-row';

    const teamHeader = document.createElement('div');
    teamHeader.className = 'team-header';

    const handle = document.createElement('span');
    handle.className = 'team-handle';
    handle.textContent = '☰';

    const label = document.createElement('span');
    label.className = 'team-label';
    label.textContent = `队伍${teamIndex + 1}`;

    teamHeader.appendChild(handle);
    teamHeader.appendChild(label);

    // 添加删除队伍按钮
    const deleteTeamBtn = document.createElement('div');
    deleteTeamBtn.className = 'delete-team-btn';
    deleteTeamBtn.textContent = '×';
    deleteTeamBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (teams.length > 1) {
        // 释放队伍中的角色
        team.slots.forEach(slot => {
          if (slot) {
            // 角色会在下次渲染时自动释放
          }
        });
        // 删除队伍
        teams.splice(teamIndex, 1);
        saveData();
        renderTeamPage();
      }
    });
    row.appendChild(deleteTeamBtn);

    const slotsDiv = document.createElement('div');
    slotsDiv.className = 'team-slots';

    team.slots.forEach((slot, slotIndex) => {
      const slotDiv = document.createElement('div');
      slotDiv.className = 'slot';
      slotDiv.addEventListener('dragover', (e) => e.preventDefault());
      slotDiv.addEventListener('drop', (e) => {
        e.preventDefault();
        const data = JSON.parse(e.dataTransfer.getData('text/plain'));
        if (data.type === 'character') {
          const char = characters.find(c => c.name === data.name);
          if (!char) return;
          const rem = getRemainingUses(char);
          const teamHasChar = team.slots.some(slot => slot && slot.name === char.name);
          if ((rem > 0 || (slot && slot.name === char.name)) && !teamHasChar) {
            team.slots[slotIndex] = { name: char.name };
            saveData();
            renderTeamPage();
          }
        } else if (data.type === 'slot') {
          const [fromTeam, fromSlot] = data.index;
          const fromChar = teams[fromTeam].slots[fromSlot];
          const targetTeamHasChar = teams[teamIndex].slots.some(s => s && s.name === fromChar.name);
          if (!targetTeamHasChar || fromTeam === teamIndex) {
            // 交换角色位置
            const temp = teams[fromTeam].slots[fromSlot];
            teams[fromTeam].slots[fromSlot] = team.slots[slotIndex];
            team.slots[slotIndex] = temp;
            saveData();
            renderTeamPage();
          }
        }
      });

      if (slot) {
      const img = document.createElement('img');
      img.src = getAvatar(slot.name);
      img.alt = slot.name;
      img.onerror = function() { handleImgError(this); };
      slotDiv.appendChild(img);

      const char = characters.find(c => c.name === slot.name);
      if (char && showAttr) {
        const attr = document.createElement('div');
        attr.className = 'attr';
        attr.textContent = `${char.chain}+${char.weapon}`;
        slotDiv.appendChild(attr);
      }

        // 添加删除按钮
        const deleteBtn = document.createElement('div');
        deleteBtn.className = 'delete-btn';
        deleteBtn.textContent = '×';
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          team.slots[slotIndex] = null;
          saveData();
          renderTeamPage();
        });
        slotDiv.appendChild(deleteBtn);

        slotDiv.draggable = true;
        slotDiv.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'slot', index: [teamIndex, slotIndex] }));
        });
      }

      slotsDiv.appendChild(slotDiv);
    });

    const clearBtn = document.createElement('button');
    clearBtn.className = 'clear-btn';
    clearBtn.textContent = '清空';
    clearBtn.addEventListener('click', () => {
      team.slots = [null, null, null];
      saveData();
      renderTeamPage();
    });

    row.appendChild(teamHeader);
    row.appendChild(slotsDiv);
    row.appendChild(clearBtn);

    section.appendChild(row);
  });

  // 添加队伍按钮（放到底部工具行，位于配置按钮左侧）
  const addTeamBtn = document.createElement('button');
  addTeamBtn.className = 'add-team-btn';
  addTeamBtn.textContent = '添加队伍';
  addTeamBtn.addEventListener('click', () => {
    teams.push({ slots: [null, null, null] });
    saveData();
    renderTeamPage();
  });
  const footer = document.querySelector('.team-footer');
  const oldAddBtn = footer.querySelector('.add-team-btn');
  if (oldAddBtn) oldAddBtn.remove();
  footer.insertBefore(addTeamBtn, footer.firstChild);

  // 初始化队伍排序
  if (sortableInstance) sortableInstance.destroy();
  sortableInstance = new Sortable(section, {
    handle: '.team-handle',
    animation: 150,
    onEnd(evt) {
      const oldIndex = evt.oldIndex;
      const newIndex = evt.newIndex;
      if (oldIndex !== newIndex && oldIndex < teams.length && newIndex < teams.length) {
        const temp = teams[oldIndex];
        teams.splice(oldIndex, 1);
        teams.splice(newIndex, 0, temp);
        saveData();
        renderTeams();
      }
    },
  });

  updateLayoutScale();
}

// 初始化
const savedCurrentUser = localStorage.getItem('currentUser');
if (savedCurrentUser) {
  currentUser = parseInt(savedCurrentUser, 10);
} else {
  currentUser = 1;
  localStorage.setItem('currentUser', '1');
}
loadData();
document.getElementById('userSelect').value = currentUser.toString();
showPage('role')