// ================= 用户管理、导航与初始化 =================
// 这一层只做「界面编排」：改数据一律走 commit()，不直接写 localStorage。

function rerenderCurrentPage() {
  if (!document.getElementById('teamPage').classList.contains('hidden')) renderTeamPage();
  else if (!document.getElementById('bossPage').classList.contains('hidden')) renderBossPage();
  else renderRoleList();
}

function showPage(page) {
  writeStore('activePage', page); // 记录当前激活页面，刷新后保持（写失败不影响切页）
  document.getElementById('rolePage').classList.toggle('hidden', page !== 'role');
  document.getElementById('teamPage').classList.toggle('hidden', page !== 'team');
  document.getElementById('bossPage').classList.toggle('hidden', page !== 'boss');
  // 导航激活态：高亮当前页按钮
  document.getElementById('roleBtn').classList.toggle('active', page === 'role');
  document.getElementById('teamBtn').classList.toggle('active', page === 'team');
  document.getElementById('bossBtn').classList.toggle('active', page === 'boss');
  if (page === 'role') renderRoleList();
  if (page === 'team') renderTeamPage();
  if (page === 'boss') renderBossPage();
}

// ================= 用户列表 =================
function renderUserList() {
  const list = document.getElementById('userList');
  list.innerHTML = '';

  if (meta.users.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'user-desc';
    empty.style.padding = '20px 0';
    empty.style.textAlign = 'center';
    empty.textContent = '暂无用户，请点击下方按钮添加';
    list.appendChild(empty);
  }

  meta.users.forEach(u => {
    const card = document.createElement('div');
    card.className = 'user-card' + (u.uid === meta.currentUid ? ' active' : '');
    card.dataset.uid = u.uid;

    const left = document.createElement('div');
    left.className = 'card-left';

    const nameRow = document.createElement('div');
    nameRow.className = 'name-row';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'user-name';
    nameSpan.textContent = u.name;
    const editBtn = document.createElement('button');
    editBtn.className = 'edit-btn';
    editBtn.textContent = '✎';
    editBtn.title = '重命名';
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); startRename(card, u); });
    nameRow.appendChild(nameSpan);
    nameRow.appendChild(editBtn);

    const desc = document.createElement('div');
    desc.className = 'user-desc';
    desc.textContent = `持有 ${getCharCount(u.uid)} 个角色`;

    left.appendChild(nameRow);
    left.appendChild(desc);

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    actions.appendChild(mkBtn('导入', 'btn-import', () => openImport(u.uid)));
    actions.appendChild(mkBtn('导出', 'btn-export', () => openExport(u.uid)));
    actions.appendChild(mkBtn('删除', 'btn-delete', () => openDelete(u.uid)));

    card.appendChild(left);
    card.appendChild(actions);

    // 点击卡片主体激活该用户
    card.addEventListener('click', () => {
      if (meta.currentUid !== u.uid) {
        loadUser(u.uid);
        renderUserList();
        rerenderCurrentPage();
      }
    });

    list.appendChild(card);
  });

  // 添加用户虚线框（不自动激活）
  const add = document.createElement('div');
  add.className = 'add-user';
  const addBtn = document.createElement('button');
  addBtn.textContent = '＋ 添加用户';
  addBtn.addEventListener('click', () => { addUser(defaultUserName(), false); renderUserList(); });
  add.appendChild(addBtn);
  list.appendChild(add);
}

function mkBtn(text, cls, handler) {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = text;
  b.addEventListener('click', (e) => { e.stopPropagation(); handler(); });
  return b;
}

// 编辑名字
function startRename(card, u) {
  const nameSpan = card.querySelector('.user-name');
  const editBtn = card.querySelector('.edit-btn');
  const input = document.createElement('input');
  input.className = 'name-input';
  input.value = u.name;

  nameSpan.replaceWith(input);
  if (editBtn) editBtn.style.visibility = 'hidden'; // 不再重复 replaceWith 同一个节点
  input.focus();
  input.select();

  // Enter 与 Esc 都通过 blur 收尾，用 cancelled 区分「提交」与「取消」：
  // 取消时绝不能写 u.name，否则界面显示新名字、存储还是旧名字（要等下一次 saveMeta 才被悄悄写入）
  let cancelled = false;
  let finished = false;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { cancelled = true; input.blur(); }
    else if (e.key === 'Enter') input.blur();
  });
  input.addEventListener('blur', () => {
    if (finished) return;
    finished = true;
    if (!cancelled) {
      const name = input.value.trim();
      if (name && name !== u.name) { u.name = name; saveMeta(); }
    }
    renderUserList();
  });
}

// ================= 导入 / 导出 / 删除 =================
// 导出（对指定用户）
function openExport(uid) {
  const code = encodeUserState(uid);
  document.getElementById('exportCodeLine').textContent = code;
  // 链接用「当前站点根 + #码」，不再硬编码 pages.dev：换域名/换子路径都不需要改代码，
  // 本地 file:// 之外的环境也能直接分享。旧版 /import#码 的链接仍可被 handleUrlHashImport 识别。
  document.getElementById('exportUrlLine').textContent = siteBase() + '#' + code;
  showModal('exportModal');
}

// 导入（对指定用户）
let importTarget = null;
function openImport(uid) {
  importTarget = uid;
  document.getElementById('importMsg').textContent = '';
  document.getElementById('importMsg').className = 'msg';
  document.getElementById('importInput').value = '';
  showModal('importModal');
  setTimeout(() => document.getElementById('importInput').focus(), 0);
}

// 删除（二次确认）
let deleteTarget = null;
function openDelete(uid) {
  deleteTarget = uid;
  const u = getUser(uid);
  document.getElementById('deleteName').textContent = u ? u.name : '';
  showModal('deleteModal');
}

// 复制
async function copyToClipboard(text, btn) {
  const old = btn.textContent;
  const flash = (label) => {
    btn.textContent = label;
    setTimeout(() => { btn.textContent = old; }, 1200);
  };
  // 首选 Clipboard API（需要安全上下文：https 或 localhost）
  try {
    await navigator.clipboard.writeText(text);
    flash('已复制');
    return;
  } catch (e) { /* 降级到 execCommand */ }
  // 降级：execCommand('copy') 会返回 false 而不是抛错，之前没检查返回值 → 「提示已复制、剪贴板却是空的」
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = !!(document.execCommand && document.execCommand('copy')); } catch { ok = false; }
  if (ok) { ta.remove(); flash('已复制'); return; }
  // 仍失败：保留选中内容，明确告诉用户手动复制，而不是假报成功
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, text.length);
  ta.addEventListener('blur', () => setTimeout(() => ta.remove(), 0));
  flash('请按 Ctrl+C');
  showToast('自动复制失败，内容已选中，请按 Ctrl+C 手动复制');
}

// ================= 清空全部数据 =================
function clearAllData() {
  showModal('clearModal');
}
function confirmClearAll() {
  if (meta.users) meta.users.forEach(u => localStorage.removeItem(`userData_${u.uid}`));
  meta = { seq: 0, currentUid: null, users: [] };
  localStorage.removeItem('globalShowAttr');
  localStorage.removeItem('globalShowScore');
  ensureUser(); // 清空后自动补 1 个默认用户
  loadUser(meta.currentUid);
  saveMeta();
  showAttr = true;
  const at = document.getElementById('attrToggle');
  if (at) at.checked = true;
  showScore = true;
  const st = document.getElementById('scoreToggle');
  if (st) st.checked = true;
  applyScoreVisibility();
  renderUserList();
  rerenderCurrentPage();
  hideModal('clearModal');
}

// ================= URL 带码访问自动导入 =================
// 支持两种形式：#状态码  （现行导出格式，与部署路径无关）
//              /import#状态码 （旧版导出链接，继续兼容）
function handleUrlHashImport() {
  const hash = location.hash;
  if (!hash || hash.length < 2) return;
  const code = hash.slice(1);

  // 先校验再决定要不要建用户：任何解析不了的 hash（分享码写错/被截断、误访问 /#foo）
  // 都不应该凭空造出一个空白用户。清掉 URL 上的脏 hash，避免刷新反复提示。
  const decoded = decodeState(code);
  if (!decoded.ok) {
    history.replaceState(null, '', siteBase() + location.search);
    showToast(`链接里的分享码无效（${decoded.error}），可能被截断或抄错，请让分享者重新发一次链接。`);
    return;
  }

  // 若已有用户的编码状态与链接码一致，直接激活该用户，不新建
  for (const u of meta.users) {
    if (encodeUserState(u.uid) === code) {
      loadUser(u.uid);
      history.replaceState(null, '', siteBase() + location.search);
      return;
    }
  }

  const prevUid = meta.currentUid;
  const uid = addUser(defaultUserName(), true); // 新建用户并设为当前
  const res = importStateToUser(uid, code);
  if (!res.ok) {
    // 兜底回滚（正常不会触发，decodeState 已校验过）：不留下一个没有任何数据的空用户
    meta.users = meta.users.filter(u => u.uid !== uid);
    meta.currentUid = prevUid;
    localStorage.removeItem(`userData_${uid}`);
    saveMeta();
    history.replaceState(null, '', siteBase() + location.search);
    showToast(`导入失败：${res.error}`);
    return;
  }
  loadUser(uid);
  // 清除 URL 中的状态码，避免之后每次刷新/收藏都重新导入一份
  history.replaceState(null, '', siteBase() + location.search);
}

// ================= 事件绑定 =================
document.getElementById('roleBtn').addEventListener('click', () => showPage('role'));
document.getElementById('teamBtn').addEventListener('click', () => showPage('team'));
document.getElementById('bossBtn').addEventListener('click', () => showPage('boss'));
document.getElementById('clearBtn').addEventListener('click', clearAllData);
document.getElementById('userMgrBtn').addEventListener('click', () => {
  renderUserList();
  showModal('userModal');
});

// data-close：仅关闭自身所在弹窗，保留父级“用户管理”窗口
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => {
    const o = btn.closest('.overlay');
    if (o) o.classList.remove('show');
  });
});
// 点击遮罩空白处关闭
document.querySelectorAll('.overlay').forEach(o => {
  o.addEventListener('mousedown', (e) => { if (e.target === o) o.classList.remove('show'); });
});
// 复制按钮
document.querySelectorAll('.copy-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const line = document.getElementById(btn.dataset.copy);
    if (line) copyToClipboard(line.textContent.trim(), btn);
  });
});
// 分享码条导入：作用于当前用户（复用用户管理导入弹窗）
document.getElementById('leftStatusImport').addEventListener('click', (e) => {
  e.stopPropagation();
  if (meta.currentUid == null) return;
  openImport(meta.currentUid);
});
// 导入确定：接受纯状态码或含状态码的链接，自动提取'#'后的码
document.getElementById('importOk').addEventListener('click', () => {
  const val = document.getElementById('importInput').value.trim();
  const msg = document.getElementById('importMsg');
  if (!val) { msg.textContent = '请输入分享码或链接'; msg.className = 'msg err'; return; }
  if (importTarget == null) return;
  const hashIdx = val.lastIndexOf('#');
  const code = hashIdx >= 0 ? val.slice(hashIdx + 1) : val;
  const res = importStateToUser(importTarget, code);
  if (!res.ok) {
    msg.textContent = res.error;
    msg.className = 'msg err';
    return;
  }
  const u = getUser(importTarget);
  msg.textContent = `已导入到“${u ? u.name : ''}”`;
  msg.className = 'msg ok';
  renderUserList();
  if (importTarget === meta.currentUid) { loadUser(importTarget); rerenderCurrentPage(); }
  setTimeout(() => hideModal('importModal'), 900);
});
document.getElementById('importInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('importOk').click();
});
// 清空数据确认
document.getElementById('clearOk').addEventListener('click', confirmClearAll);
// 「全部没有」确认
const clearOwnedOk = document.getElementById('clearOwnedOk');
if (clearOwnedOk) clearOwnedOk.addEventListener('click', confirmClearOwned);

// 删除确认
document.getElementById('deleteOk').addEventListener('click', () => {
  if (deleteTarget == null) return;
  const uid = deleteTarget;
  const wasCurrent = meta.currentUid === uid;
  meta.users = meta.users.filter(u => u.uid !== uid);
  localStorage.removeItem(`userData_${uid}`);
  if (meta.users.length === 0) ensureUser(); // 删除全部用户后自动补 1 个
  if (wasCurrent) {
    meta.currentUid = meta.users[0].uid;
    loadUser(meta.currentUid);
  }
  saveMeta();
  deleteTarget = null;
  hideModal('deleteModal');
  renderUserList();
  rerenderCurrentPage();
});

// 页面3“显示分数”开关（全局，跨刷新保留）
function applyScoreVisibility() {
  const page = document.getElementById('bossPage');
  if (page) page.classList.toggle('no-score', !showScore);
  updateBossLayout();
}

// ================= 初始化 =================
migrateLegacy();
loadMeta();
ensureUser(); // 无用户时自动生成 1 个默认用户

// 读取全局开关
const savedGlobalShowAttr = localStorage.getItem('globalShowAttr');
if (savedGlobalShowAttr !== null) showAttr = savedGlobalShowAttr === 'true';
document.getElementById('attrToggle').checked = showAttr;

document.getElementById('attrToggle').addEventListener('change', function () {
  showAttr = this.checked;
  commit(); // 走统一入口：规范化 → 落盘 → 重绘（默认重绘当前页）
});

const savedGlobalShowScore = localStorage.getItem('globalShowScore');
if (savedGlobalShowScore !== null) showScore = savedGlobalShowScore === 'true';
const scoreToggleEl = document.getElementById('scoreToggle');
scoreToggleEl.checked = showScore;
scoreToggleEl.addEventListener('change', function () {
  showScore = this.checked;
  writeStore('globalShowScore', showScore.toString());
  applyScoreVisibility();
});
applyScoreVisibility();

if (meta.currentUid != null) loadUser(meta.currentUid);
handleUrlHashImport();
renderUserList();
// 首屏显示上次激活的页面（默认角色页），并持久化
const prevPage = localStorage.getItem('activePage');
showPage(['role', 'team', 'boss'].includes(prevPage) ? prevPage : 'role');
