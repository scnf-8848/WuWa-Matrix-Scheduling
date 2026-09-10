// 角色模板数据（固定不变）
// 添加新角色只需在此文件任意位置追加 {id: 数字, name: '角色名', totalUses: 数字} 即可
// 头像图片会自动从 character/ 文件夹中按角色名匹配（支持 webp/jpg/jpeg/png/gif）
// 6星限定角色排序按常见配队微调
//
// ==================== id 纪律（分享码依赖，务必遵守）====================
// 1. id 是分享码的“编码顺序键”：分享码按 id 从小到大逐位记录角色状态。
// 2. 新增角色：id 一律取「当前最大已实装 id + 1」；写在文件的哪一行随意，
//    因为网页展示顺序 = 本文件的书写顺序，与 id 无关（可自由调整配队分组）。
// 3. 已有角色的 id 永远不要改、不要复用、不要在中间插入空号。
//    只有「新增」才占用新号；插入中间号会让所有老分享码整段错位。
// 4. 未实装角色用 id > 1000 临时占位，不参与分享码；实装时改成「最大已实装 id + 1」。
// 5. 不要删除已实装角色（会让其后所有位置前移，老分享码错位）；如需隐藏请保留条目。
// 当前 id 范围：1 ~ 55 已实装，1003 ~ 1004 未实装。
// ======================================================================

const characterTemplates = [
  { id: 4,  name: '漂泊者', totalUses: 1 },
  { id: 1,  name: '秧秧', totalUses: 1 },
  { id: 2,  name: '炽霞', totalUses: 1 },
  { id: 5,  name: '白芷', totalUses: 2 },
  { id: 6,  name: '散华', totalUses: 1 },
  { id: 8,  name: '桃祈', totalUses: 1 },
  { id: 9,  name: '丹瑾', totalUses: 1 },
  { id: 11, name: '秋水', totalUses: 1 },
  { id: 12, name: '莫特斐', totalUses: 1 },
  { id: 14, name: '渊武', totalUses: 1 },
  { id: 25, name: '釉瑚', totalUses: 1 },
  { id: 24, name: '灯灯', totalUses: 1 },
  { id: 43, name: '卜灵', totalUses: 2 },

  { id: 3,  name: '维里奈', totalUses: 2 },
  { id: 7,  name: '安可', totalUses: 1 },
  { id: 13, name: '凌阳', totalUses: 1 },
  { id: 17, name: '鉴心', totalUses: 1 },
  { id: 16, name: '卡卡罗', totalUses: 1 },

  { id: 10, name: '忌炎', totalUses: 1 },
  { id: 18, name: '今汐', totalUses: 1 },
  { id: 20, name: '长离', totalUses: 1 },
  { id: 19, name: '相里要', totalUses: 1 },
  { id: 15, name: '吟霖', totalUses: 1 },
  { id: 22, name: '守岸人', totalUses: 2 },
  { id: 23, name: '椿', totalUses: 1 },

  { id: 27, name: '洛可可', totalUses: 1 },
  { id: 33, name: '布兰特', totalUses: 1 },
  { id: 26, name: '珂莱塔', totalUses: 1 },
  { id: 21, name: '折枝', totalUses: 1 },
  { id: 30, name: '赞妮', totalUses: 1 },
  { id: 34, name: '菲比', totalUses: 1 },
  { id: 32, name: '弗洛洛', totalUses: 1 },
  { id: 28, name: '坎特蕾拉', totalUses: 1 },
  { id: 31, name: '卡提希娅', totalUses: 1 },
  { id: 29, name: '夏空', totalUses: 1 },
  { id: 42, name: '千咲', totalUses: 1 },

  { id: 37, name: '奥古斯塔', totalUses: 1 },
  { id: 36, name: '尤诺', totalUses: 1 },
  { id: 35, name: '露帕', totalUses: 1 },
  { id: 40, name: '嘉贝莉娜', totalUses: 1 },
  { id: 41, name: '仇远', totalUses: 1 },

  { id: 38, name: '爱弥斯', totalUses: 1 },
  { id: 44, name: '琳奈', totalUses: 1 },
  { id: 45, name: '莫宁', totalUses: 2 },
  { id: 39, name: '陆·赫斯', totalUses: 1 },
  { id: 47, name: '西格莉卡', totalUses: 1 },
  { id: 46, name: '达妮娅', totalUses: 1 },
  { id: 49, name: '绯雪', totalUses: 1 },
  { id: 48, name: '洛瑟拉', totalUses: 1 },
  { id: 50, name: '露西', totalUses: 1 },
  { id: 51, name: '丽贝卡', totalUses: 1 },

  { id: 52, name: '秧秧·玄翎', totalUses: 1 },
  { id: 53, name: '穗穗', totalUses: 2 },
  { id: 54, name: '清宵', totalUses: 1 },
  { id: 55, name: '景燃', totalUses: 1 },

  // 未实装，id 临时占位（>1000，不参与分享码）；实装时改为「最大已实装 id + 1」

  { id: 1003, name: '心', totalUses: 1 },
  { id: 1004, name: '锁暝', totalUses: 1 },

  //{ id: 104, name: 'None', totalUses: 1 },
  // ...后续手动追加
];
