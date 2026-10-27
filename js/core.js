// ================= 基础层：不碰业务状态，任何页面都能用 =================

// 图片扩展名回退列表（webp 优先，按此顺序逐个尝试）
const IMAGE_EXTENSIONS = ['webp', 'png', 'jpg', 'jpeg', 'gif'];

// 根据角色名生成头像路径：固定从列表第一个（webp）开始，失败后由 onerror 逐级向后回退。
// 刻意不缓存「哪个扩展名可用」：扩展名是每个文件各自的属性，而回退链只能向后走 ——
// 万一全局被记成了 jpg，那些只有 webp 的头像就永远回不到 webp（直接漏图）。
// 让每张图各自从 webp 起匹配，混搭格式也一定能走到自己的真实文件；全站统一 webp 时零额外请求。
function getAvatar(name) {
  return `character/${name}.${IMAGE_EXTENSIONS[0]}`;
}

// 图片加载失败时，按顺序尝试下一个扩展名（每张图独立，无共享状态）
function handleImgError(img) {
  const match = img.src.match(/^(.*)\.([^.]+)$/);
  if (!match) return;
  const basePath = match[1];
  const currentExt = match[2].toLowerCase();
  const currentIndex = IMAGE_EXTENSIONS.indexOf(currentExt);
  // 已到列表末尾（或当前扩展名不认识）就不再改动，避免反复回退
  if (currentIndex >= 0 && currentIndex < IMAGE_EXTENSIONS.length - 1) {
    img.src = `${basePath}.${IMAGE_EXTENSIONS[currentIndex + 1]}`;
  }
}

// ================= 存储写入 =================
// 写盘失败（隐私模式 / 配额已满 / 存储被禁用）时只提示一次，避免每次点击都刷屏。
// 关键点：异常不能冒泡到事件处理器外面 —— 否则本次操作后续的重渲染会被跳过，
// 界面停在旧状态、内存却已改动，用户会以为没点到，刷新后数据又回退。
let saveFailed = false;
function warnSaveFailed() {
  if (saveFailed) return;
  saveFailed = true;
  showToast('保存失败：浏览器存储不可用或空间已满。本次修改只在当前页面有效，刷新后会丢失。');
}
function writeStore(key, value) {
  try { localStorage.setItem(key, value); saveFailed = false; return true; }
  catch { warnSaveFailed(); return false; }
}

// ================= 轻提示与模态窗 =================
// 轻提示：用于“链接里的分享码无效”这类无法挂到某个输入框上的失败提示
let toastTimer = null;
function showToast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}

function showModal(id) { document.getElementById(id).classList.add('show'); }
function hideModal(id) { document.getElementById(id).classList.remove('show'); }

// ================= 站点根 =================
// 站点根（以 / 结尾）：与部署方式无关 —— pages.dev 根域、GH Pages 子目录、自定义域名都适用。
// 规则：去掉可能存在的 /import 入口路径；只把「文件名」部分去掉（末段带扩展名，如 index.html）；
//       其余情况（含无结尾斜杠的 /repo 这种目录路径）原样保留并补上斜杠，避免误删整段路径。
function siteBase() {
  let path = location.pathname.replace(/\/import\/?$/, '/');
  if (/\.[^/]*$/.test(path)) path = path.replace(/[^/]*$/, '');
  if (!path.endsWith('/')) path += '/';
  // file:// 下 origin 是字符串 "null"，直接拼接会得到 "null/#码"；此时退化为同目录的 file 地址
  const origin = (location.origin && location.origin !== 'null') ? location.origin : location.protocol + '//';
  return origin + path;
}

// ================= keyed 渲染 =================
// 以前每次 commit 都重建整块列表：61 张头像重新解码、滚动位置与悬停态丢失、拖拽句柄重绑。
// 这两个助手让「同 key 的节点原地更新」，只增删真正变化的项。
//
// 换用户（或整份导入）时 dataEpoch 自增，容器世代不符就整体重建 ——
// 节点上挂着的事件处理器捕获的是上一批角色对象，跨用户复用会把改动写到已失效的数据上。
function renderEpoch(container) {
  if (!container) return false;
  if (container.dataset.epoch === String(dataEpoch)) return false;
  container.innerHTML = '';
  container.dataset.epoch = String(dataEpoch);
  return true;
}
// 传入 pool 可以让节点在两个容器之间搬迁（页面1 的「已持有 / 未持有」就是同一批节点在搬家）。
// 返回本次用到的 key 集合；调用方据此删除 pool 里已不存在于数据中的节点。
function reconcile(container, items, keyOf, create, update, pool) {
  const ownPool = !pool;
  if (ownPool) {
    pool = new Map();
    Array.from(container.children).forEach(n => {
      if (n.dataset && n.dataset.key != null) pool.set(n.dataset.key, n);
    });
  }
  const used = new Set();
  let prev = null;
  items.forEach(item => {
    const key = String(keyOf(item));
    let node = pool.get(key);
    if (!node) {
      node = create(item);
      node.dataset.key = key;
      pool.set(key, node);
    }
    used.add(key);
    update(node, item);
    // 按数据顺序放回：at 必须在移动之前取，否则节点已被摘走会算错位置
    const at = prev ? prev.nextSibling : container.firstChild;
    if (at !== node) container.insertBefore(node, at);
    prev = node;
  });
  if (ownPool) pool.forEach((node, key) => { if (!used.has(key)) node.remove(); });
  return used;
}

// ================= 空态 =================
// 空态提示（无当前用户时）
function emptyHint() {
  const h = document.createElement('div');
  h.style.cssText = 'padding:40px 0;color:#888;font-size:14px;text-align:center;grid-column:1/-1;';
  h.textContent = '暂无用户，请用左侧用户栏的「新建用户」添加或导入';
  h.style.width = '100%';
  return h;
}
