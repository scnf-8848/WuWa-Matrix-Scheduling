// 角色模板数据（固定不变）
// 添加新角色：先按下方的取号规则拿到 id，再在任意位置插入 {id, name, totalUses} 即可
// 头像图片会自动从 character/ 文件夹中按角色名匹配（支持 webp/jpg/jpeg/png/gif）
// 6星限定角色排序按常见配队微调
//
// ==================== id 纪律（分享码依赖，务必遵守）====================
// id 是分享码的“编码顺序键”：分享码按 id 从小到大逐位记录角色状态。
// 取号规则：新角色 id = 当前最大 id + 1（与行位置、全表第几个都无关）。
// 书写位置：id 与行位置解耦 —— 本文件的书写顺序只决定页面展示顺序，
//   可以按配队分组自由摆放、随时调换，不受 id 大小约束。
// 老 id 不改、不复用、不删除、不在中间插空号（否则老分享码整段错位）。
// 历史备注：本项目曾用「已实装 / 未实装」分类（未实装以 implemented: false、id 大于 1000 等约定表达），
// 该分类已弃用——所有角色一律按 id 升序参与，不要再按实装状态做任何判断。
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
  { id: 56, name: '心', totalUses: 1 },
  { id: 57, name: '锁暝', totalUses: 1 },
  { id: 58, name: '莉莉', totalUses: 2 },

  //{ id: 104, name: 'None', totalUses: 1 },
  // ...后续手动追加
];
