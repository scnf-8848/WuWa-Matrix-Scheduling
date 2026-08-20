// 角色模板数据（固定不变）
// 添加新角色只需在此文件末尾追加 {id: 数字,  name: '角色名', totalUses: 数字 } 即可
// 角色id为IconRoleHead256文件夹中角色对应图片的数字编号
// 头像图片会自动从 character/ 文件夹中按角色名匹配（支持 webp/jpg/jpeg/png/gif）
// 6星限定角色排序按常见配队微调

const characterTemplates = [
  { id: 4,  name: '漂泊者', totalUses: 1 },
  { id: 1,  name: '秧秧', totalUses: 1 },
  { id: 2,  name: '炽霞', totalUses: 1 },
  { id: 6,  name: '白芷', totalUses: 2 },
  { id: 7,  name: '散华', totalUses: 1 },
  { id: 9,  name: '桃祈', totalUses: 1 },
  { id: 10, name: '丹瑾', totalUses: 1 },
  { id: 12, name: '秋水', totalUses: 1 },
  { id: 13, name: '莫特斐', totalUses: 1 },
  { id: 15, name: '渊武', totalUses: 1 },
  { id: 31, name: '釉瑚', totalUses: 1 },
  { id: 30, name: '灯灯', totalUses: 1 },
  { id: 58, name: '卜灵', totalUses: 2 },

  { id: 3,  name: '维里奈', totalUses: 2 },
  { id: 8,  name: '安可', totalUses: 1 },
  { id: 14, name: '凌阳', totalUses: 1 },
  { id: 23, name: '鉴心', totalUses: 1 }, 
  { id: 18, name: '卡卡罗', totalUses: 1 },

  { id: 11, name: '忌炎', totalUses: 1 },
  { id: 24, name: '今汐', totalUses: 1 },
  { id: 26, name: '长离', totalUses: 1 },
  { id: 25, name: '相里要', totalUses: 1 },
  { id: 17, name: '吟霖', totalUses: 1 },
  { id: 28, name: '守岸人', totalUses: 2 },
  { id: 29, name: '椿', totalUses: 1 },

  { id: 33, name: '洛可可', totalUses: 1 },
  { id: 44, name: '布兰特', totalUses: 1 },
  { id: 32, name: '珂莱塔', totalUses: 1 },
  { id: 27, name: '折枝', totalUses: 1 },
  { id: 38, name: '赞妮', totalUses: 1 },
  { id: 45, name: '菲比', totalUses: 1 },
  { id: 41, name: '弗洛洛', totalUses: 1 },
  { id: 34, name: '坎特蕾拉', totalUses: 1 },
  { id: 40, name: '卡提希娅', totalUses: 1 },
  { id: 37, name: '夏空', totalUses: 1 },
  { id: 57, name: '千咲', totalUses: 1 },

  { id: 51, name: '奥古斯塔', totalUses: 1 },
  { id: 48, name: '尤诺', totalUses: 1 },
  { id: 46, name: '露帕', totalUses: 1 },
  { id: 55, name: '嘉贝莉娜', totalUses: 1 },
  { id: 56, name: '仇远', totalUses: 1 },

  { id: 53, name: '爱弥斯', totalUses: 1 },
  { id: 60, name: '琳奈', totalUses: 1 },
  { id: 61, name: '莫宁', totalUses: 2 },
  { id: 54, name: '陆·赫斯', totalUses: 1 },
  { id: 65, name: '西格莉卡', totalUses: 1 },
  { id: 64, name: '达妮娅', totalUses: 1 },
  { id: 67, name: '绯雪', totalUses: 1 },
  { id: 66, name: '洛瑟拉', totalUses: 1 },
  { id: 68, name: '露西', totalUses: 1 },
  { id: 69, name: '丽贝卡', totalUses: 1 },

  { id: 70, name: '秧秧·玄翎', totalUses: 1 },
  { id: 71, name: '穗穗', totalUses: 2 },

  // 未实装，id不确定 矩阵体力不确定

  { id: 101, name: '清宵', totalUses: 1 },
  { id: 102, name: '景燃', totalUses: 1 },
  { id: 103, name: '心', totalUses: 1 },
  { id: 104, name: '锁暝', totalUses: 1 },

  //{ id: 104, name: 'None', totalUses: 1 },
  // ...后续手动追加
];
