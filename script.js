// 角色模板数据（固定不变）
const characterTemplates = [
  { name: '漂泊者', avatar: 'character/漂泊者.png', totalUses: 1 },


  { name: '秧秧', avatar: 'character/秧秧.png', totalUses: 1 },
  { name: '炽霞', avatar: 'character/炽霞.png', totalUses: 1 },
  { name: '维里奈', avatar: 'character/维里奈.png', totalUses: 2 },
  { name: '白芷', avatar: 'character/白芷.png', totalUses: 2 },
  { name: '散华', avatar: 'character/散华.png', totalUses: 1 },
  { name: '安可', avatar: 'character/安可.png', totalUses: 1 },
  { name: '桃祈', avatar: 'character/桃祈.png', totalUses: 1 },
  { name: '丹瑾', avatar: 'character/丹瑾.png', totalUses: 1 },
  { name: '忌炎', avatar: 'character/忌炎.png', totalUses: 1 },
  { name: '秋水', avatar: 'character/秋水.png', totalUses: 1 },
  { name: '莫特斐', avatar: 'character/莫特斐.png', totalUses: 1 },
  { name: '凌阳', avatar: 'character/凌阳.png', totalUses: 1 },
  { name: '渊武', avatar: 'character/渊武.png', totalUses: 1 },
  { name: '吟霖', avatar: 'character/吟霖.png', totalUses: 1 },
  { name: '卡卡罗', avatar: 'character/卡卡罗.png', totalUses: 1 },
  { name: '鉴心', avatar: 'character/鉴心.png', totalUses: 1 },
  { name: '今汐', avatar: 'character/今汐.png', totalUses: 1 },
  { name: '相里要', avatar: 'character/相里要.png', totalUses: 1 },
  { name: '长离', avatar: 'character/长离.png', totalUses: 1 },
  { name: '折枝', avatar: 'character/折枝.png', totalUses: 1 },
  { name: '守岸人', avatar: 'character/守岸人.png', totalUses: 2 },
  { name: '椿', avatar: 'character/椿.png', totalUses: 1 },
  { name: '灯灯', avatar: 'character/灯灯.png', totalUses: 1 },
  { name: '釉瑚', avatar: 'character/釉瑚.png', totalUses: 1 },
  { name: '珂莱塔', avatar: 'character/珂莱塔.png', totalUses: 1 },
  { name: '洛可可', avatar: 'character/洛可可.png', totalUses: 1 },
  { name: '坎特蕾拉', avatar: 'character/坎特蕾拉.png', totalUses: 1 },
  { name: '夏空', avatar: 'character/夏空.png', totalUses: 1 },
  { name: '赞妮', avatar: 'character/赞妮.png', totalUses: 1 },
  { name: '卡提希娅', avatar: 'character/卡提希娅.png', totalUses: 1 },
  { name: '弗洛洛', avatar: 'character/弗洛洛.png', totalUses: 1 },
  { name: '布兰特', avatar: 'character/布兰特.png', totalUses: 1 },
  { name: '菲比', avatar: 'character/菲比.png', totalUses: 1 },
  { name: '露帕', avatar: 'character/露帕.png', totalUses: 1 },
  { name: '尤诺', avatar: 'character/尤诺.png', totalUses: 1 },
  { name: '奥古斯塔', avatar: 'character/奥古斯塔.png', totalUses: 1 },
  { name: '爱弥斯', avatar: 'character/爱弥斯.png', totalUses: 1 },
  { name: '陆·赫斯', avatar: 'character/陆·赫斯.png', totalUses: 1 },
  { name: '嘉贝莉娜', avatar: 'character/嘉贝莉娜.png', totalUses: 1 },
  { name: '仇远', avatar: 'character/仇远.png', totalUses: 1 },
  { name: '千咲', avatar: 'character/千咲.png', totalUses: 1 },
  { name: '卜灵', avatar: 'character/卜灵.png', totalUses: 2 },
  { name: '琳奈', avatar: 'character/琳奈.png', totalUses: 1 },
  { name: '莫宁', avatar: 'character/莫宁.png', totalUses: 2 },
  { name: '西格莉卡', avatar: 'character/西格莉卡.png', totalUses: 1 },


  
  // ...后续手动追加
];

// 用户角色数据（动态生成）
let characters = [];
let currentSelectedRoleIndex = null;

let teams = Array.from({ length: 3 }, () => ({ slots: [null, null, null] }));
let sortableInstance = null;

// 初始化角色数据
function initializeCharacters() {
  const savedUserData = localStorage.getItem('userCharacterData');
  if (savedUserData) {
    const userData = JSON.parse(savedUserData);
    characters = characterTemplates.map((template, index) => {
      const userChar = userData[index] || { owned: false, chain: 0, weapon: 0 };
      return { ...template, ...userChar };
    });
  } else {
    // 新用户：所有角色默认不拥有
    characters = characterTemplates.map(template => ({
      ...template,
      owned: false,
      chain: 0,
      weapon: 0
    }));
  }
}

// 存读本地
function loadData() {
  initializeCharacters();
  const saved = localStorage.getItem('gameScheduler');
  if (saved) {
    const data = JSON.parse(saved);
    if (data.teams) {
      teams = data.teams;
    } else {
      teams = Array.from({ length: 12 }, () => ({ slots: [null, null, null] }));
    }
  } else {
    teams = Array.from({ length: 12 }, () => ({ slots: [null, null, null] }));
  }
}
function saveData() {
  // 只保存用户特定的数据
  const userData = characters.map(char => ({
    owned: char.owned,
    chain: char.chain,
    weapon: char.weapon
  }));
  localStorage.setItem('userCharacterData', JSON.stringify(userData));
  localStorage.setItem('gameScheduler', JSON.stringify({ teams }));
}

// 清空所有数据
function clearAllData() {
  if (confirm('确定要清空所有用户数据吗？此操作将清除所有角色和队伍数据，且无法恢复。')) {
    localStorage.removeItem('userCharacterData');
    localStorage.removeItem('gameScheduler');
    loadData();
    showPage('role');
  }
}

// 导航
document.getElementById('roleBtn').addEventListener('click', () => showPage('role'));
document.getElementById('teamBtn').addEventListener('click', () => showPage('team'));
document.getElementById('clearBtn').addEventListener('click', clearAllData);

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
    item.innerHTML = `<img src="${char.avatar}" alt="${char.name}">`;

    const nameOverlay = document.createElement('div');
    nameOverlay.className = 'name-overlay';
    nameOverlay.textContent = char.name;
    item.appendChild(nameOverlay);

    // 添加属性显示
    const attr = document.createElement('div');
    attr.className = 'attr';
    attr.textContent = `${char.chain}+${char.weapon}`;
    item.appendChild(attr);

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
  
  // 生成链数按钮
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
    <img src="${char.avatar}" alt="${char.name}">
    <h3>${char.name}</h3>
    <div class="attr-group">
      <label>链数:</label>
      <div class="attr-buttons">${chainButtons}</div>
    </div>
    <div class="attr-group">
      <label>专武:</label>
      <div class="attr-buttons">${weaponButtons}</div>
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

function getRemainingUses(char) {
  const used = teams.flatMap(team => team.slots).filter(slot => slot && slot.name === char.name).length;
  return Math.max(0, char.totalUses - used);
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
    item.innerHTML = `<img src="${char.avatar}" alt="${char.name}">`;

    const nameOverlay = document.createElement('div');
    nameOverlay.className = 'name-overlay';
    nameOverlay.textContent = char.name;
    item.appendChild(nameOverlay);

    const attr = document.createElement('div');
    attr.className = 'attr';
    attr.textContent = `${char.chain}+${char.weapon}`;
    item.appendChild(attr);

    const uses = document.createElement('div');
    uses.className = `uses ${remaining > 0 ? 'green' : 'red'}`;
    uses.textContent = `${remaining}`;
    item.appendChild(uses);

    item.addEventListener('dragstart', (e) => {
      const currentRemaining = getRemainingUses(char);
      if (currentRemaining <= 0) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'character', index }));
    });

    item.addEventListener('dragover', (e) => e.preventDefault());

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
          const char = characters[data.index];
          const rem = getRemainingUses(char);
          const teamHasChar = team.slots.some(slot => slot && slot.name === char.name);
          if ((rem > 0 || (slot && slot.name === char.name)) && !teamHasChar) {
            // 替换槽位角色，原角色释放回角色池
            team.slots[slotIndex] = { name: char.name, avatar: char.avatar };
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
        img.src = slot.avatar;
        img.alt = slot.name;
        slotDiv.appendChild(img);

        const char = characters.find(c => c.name === slot.name);
        if (char) {
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

  // 添加队伍按钮
  const addTeamBtn = document.createElement('button');
  addTeamBtn.className = 'add-team-btn';
  addTeamBtn.textContent = '添加队伍';
  addTeamBtn.addEventListener('click', () => {
    teams.push({ slots: [null, null, null] });
    saveData();
    renderTeamPage();
  });
  section.appendChild(addTeamBtn);

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
}

// 初始化
loadData();
showPage('role')