// ================= 分享码编解码（v2 稠密） =================
// 纯逻辑：只依赖 characterTemplates，不碰 DOM 也不碰存储，可单独测试。
// 读写某个用户（迁移旧格式、写盘）在 store.js 的 encodeUserState / importStateToUser。
//
// 分享码 = [按 6bit 打包的 base64url 载荷] + [校验和字符]
//
// 规范顺序：已实装角色（id <= 1000）按 id 升序。新增角色只会拿更大的 id，
//           所以老码永远只对应规范顺序的前若干位，新角色自动视为未持有。
//           编码只写到「最后一个持有角色」为止，其后的角色不占任何比特
//           —— 因此码里没有「角色数 N」字段，也就没有角色数上限。
//
// 载荷结构：从规范顺序第 0 位写到最后一个持有角色，逐位写 4bit 状态值：
//   0 = 未持有；1..14 = 1 + 链*2 + 专武有无
//   15(1111) 是 4bit 里的空闲值，用作哨兵：某角色勾了「额外疲劳」时，
//   紧跟它的 4bit 状态再写一个 1111。角色状态永远不可能是 15，
//   所以解码时「往后看 4bit」即可判定，不会与下一个角色的状态混淆。
//   哨兵与「是否持有」无关：未持有角色也可以带 +1（本地一直允许勾选），
//   写进码后重新持有即可继续生效，不再出现「本地留着、分享丢掉」的不对称。
//   末尾不足 6bit 补 0；解码时多读到的 0 位会被当成「未持有」，无害。
//
// 校验和：对载荷字符做质数加权和 mod 64，权重取第 2 个质数起（3,5,7,…），
//         全为奇质数，因此任意单字符抄错都能检出。

// base64url 字母表（URL 安全，去 '='）
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64MAP = {};
B64.split('').forEach((c, i) => { B64MAP[c] = i; });

// 生成第 n 个质数动态权重，避免角色增多时手工维护权重表
const __primes = [2, 3];
function isPrime(x) {
  if (x < 2) return false;
  if (x % 2 === 0) return x === 2;
  for (let i = 3; i * i <= x; i += 2) if (x % i === 0) return false;
  return true;
}
function primeAt(n) {
  while (__primes.length < n) {
    let c = __primes[__primes.length - 1] + 1;
    while (!isPrime(c)) c++;
    __primes.push(c);
  }
  return __primes[n - 1];
}
// 权重从 primeAt(2)=3 开始，全奇质数
function calcChecksum(str) {
  let sum = 0;
  for (let i = 0; i < str.length; i++) {
    const cv = B64MAP[str[i]];
    if (cv === undefined) return null;
    sum = (sum + cv * primeAt(i + 2)) % 64;
  }
  return B64[sum];
}

// 已实装角色，按 id 升序 = 分享码规范顺序
function canonicalChars() {
  return characterTemplates.filter(t => t.id <= 1000).slice().sort((a, b) => a.id - b.id);
}

const bit4 = v => v.toString(2).padStart(4, '0');
// 单角色状态值：0 未持有；>=1 持有，(v-1) = chain*2 + 专武有无
// 链值统一钳到 0-6，避免脏数据写出超过 4bit 的值把整条流顶歪
function stateToValue(c) {
  if (!c.owned) return 0;
  const chain = Math.max(0, Math.min(6, c.chain | 0));
  return 1 + chain * 2 + (c.weapon > 0 ? 1 : 0);
}
// 状态值 → 单角色状态（纯函数：分享码只带「专武有无」，本地仍存 0-5）
function decodeValue(v) {
  if (!v) return { owned: false, chain: 0, weapon: 0 };
  const t = v - 1;
  return { owned: true, chain: Math.floor(t / 2), weapon: (t % 2 === 1) ? 1 : 0 };
}

// 角色状态 → 比特串（每个位置固定 4bit；勾了额外疲劳的角色再跟一个 1111 哨兵）
// 截断点取「最后一个持有 或 勾了额外疲劳」的位置 + 1：
//   以前只看持有，勾了 +1 的未持有角色会被截断漏掉。把它也算作值得占位的理由后，
//   代价是该位置之前的角色都要补 4bit —— 正常组队都在规范顺序前半段，码长几乎不受影响。
// 解码端无需任何改动：0000 1111 会被解成「该位未持有 + extra 含该下标」，
// 现有 decodeState 已经是这么读的；旧版本读到新码结果也一致。
function buildBits(chars, extraSet) {
  const last = chars.reduce((acc, c, i) => (c.owned || extraSet.has(c.id) ? i + 1 : acc), 0);
  let bits = '';
  for (let i = 0; i < last; i++) {
    bits += bit4(stateToValue(chars[i]));
    if (extraSet.has(chars[i].id)) bits += '1111';
  }
  return bits;
}

// 比特串按 6bit 打包成 base64url 字符（不足补 0；解码时多读到的 0 位会被当成"未持有"，无害）
function packBits(bits) {
  const padded = bits + '0'.repeat((6 - bits.length % 6) % 6);
  let out = '';
  for (let i = 0; i < padded.length; i += 6) out += B64[parseInt(padded.slice(i, i + 6), 2)];
  return out;
}

// 角色状态表 → 分享码（纯函数）。states: [{id, owned, chain, weapon}]；extraIds: 额外疲劳的 id 集合。
// 规范顺序之外的 id（未实装角色）自动忽略 —— 它们本来就不参与编码。
function encodeCharStates(states, extraIds) {
  const byId = new Map((states || []).map(s => [s.id, s]));
  const chars = canonicalChars().map(t => {
    const s = byId.get(t.id) || {};
    return { id: t.id, owned: !!s.owned, chain: s.chain || 0, weapon: s.weapon || 0 };
  });
  const body = packBits(buildBits(chars, new Set(extraIds || [])));
  return body + calcChecksum(body);
}

// 分享码 → {ok, states:[状态值...], extra:[规范序号...]}
function decodeState(code) {
  // 先做字符集预检：复制时常见的尾部空格/换行、中文引号、全角字符会让 calcChecksum 返回 null，
  // 而 null !== 校验和字符 会误报成「校验失败，可能已损坏或为旧版（v1）」——把「多了个空格」说成码坏了。
  code = String(code == null ? '' : code).trim();
  if (!code) return { ok: false, error: '分享码为空，请粘贴完整的分享码或链接' };
  for (let i = 0; i < code.length; i++) {
    if (B64MAP[code[i]] === undefined) {
      return { ok: false, error: '分享码含有非法字符（空格、换行或中文标点），请重新完整复制' };
    }
  }
  // 注意不能要求「长度 ≥ 2」：全未持有的合法码就是 1 个字符（空载荷 + 校验和 'A'）
  const body = code.slice(0, -1);
  if (calcChecksum(body) !== code.slice(-1)) {
    return { ok: false, error: '校验失败：分享码可能已损坏，或为旧版（v1）分享码' };
  }
  let bits = '';
  for (let i = 0; i < body.length; i++) {
    const v = B64MAP[body[i]];
    if (v === undefined) return { ok: false, error: '无效的分享码' };
    bits += v.toString(2).padStart(6, '0');
  }
  let pos = 0;
  const read = n => {
    if (pos + n > bits.length) return null;
    const v = parseInt(bits.slice(pos, pos + n), 2); pos += n; return v;
  };
  const peek = n => (pos + n <= bits.length) ? parseInt(bits.slice(pos, pos + n), 2) : null;
  const states = [];
  const extra = [];
  while (pos < bits.length) {
    const v = read(4);
    if (v === null) break;
    if (v > 14) return { ok: false, error: '分享码数据损坏' };
    states.push(v);
    // 紧跟其后的 1111 是「额外疲劳」哨兵（角色状态不可能是 15）
    if (peek(4) === 15) { read(4); extra.push(states.length - 1); }
  }
  return { ok: true, states, extra };
}

// 说明：把码写进某个用户、以及从某个用户导出码，都需要读写存储与迁移旧格式，
// 属于数据层，见 store.js 的 importStateToUser / encodeUserState。本文件只负责编解码。

