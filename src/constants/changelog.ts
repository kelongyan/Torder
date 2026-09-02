/**
 * F2 · T-11：更新日志与开源许可的静态内容。
 * 更新日志在每次发版时同步维护（SOP 增补项）；许可证为依赖清单摘要，
 * 全文以各项目官方仓库为准。
 */

export interface ChangelogEntry {
  version: string;
  date: string;
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "2.6.3",
    date: "2026-09-01",
    items: [
      "全新界面：对齐新设计稿的侧栏、任务列表、看板、月历与设置",
      "新增快速新建：列表底部直接输入，支持「明天 15:00 交周报 #工作 !高」速记",
      "侧栏新增标签分组，看板支持在列内直接新建事项",
      "回收站按删除时间分组，保留策略一目了然",
      "任务行显示附件数量；新增强调色、命令面板（Ctrl K）与设置搜索",
      "设置新增事项默认值与提醒通知分类：默认截止、默认优先级、速记开关、完成后是否立刻归位、系统通知与提示音",
      "恢复默认设置、更新日志与开源许可入口",
    ],
  },
  {
    version: "2.6.2",
    date: "2026-08-31",
    items: [
      "任务列表改版：勾选框、优先级标记与子任务进度条",
      "今天视图重组：逾期、今日日程与已完成三段呈现",
      "顶部工具栏重排：滑动分段视图切换、批量模式入口",
      "侧栏支持折叠（Ctrl B）与搜索聚焦（Ctrl F）",
    ],
  },
  {
    version: "2.6.1",
    date: "2026-08-28",
    items: [
      "WebDAV 同步稳定性改进与冲突处理优化",
      "循环任务生成与补漏机制加固",
      "便签 Widget 外观与布局设置",
    ],
  },
];

export interface LicenseEntry {
  name: string;
  license: string;
  usage: string;
}

export const LICENSES: LicenseEntry[] = [
  { name: "React", license: "MIT", usage: "界面框架" },
  { name: "Zustand", license: "MIT", usage: "状态管理" },
  { name: "Tailwind CSS", license: "MIT", usage: "样式工具链" },
  { name: "lucide-react", license: "ISC", usage: "图标" },
  { name: "Tauri", license: "MIT / Apache-2.0", usage: "桌面应用壳" },
  { name: "rusqlite", license: "MIT", usage: "本地数据库" },
  { name: "tokio", license: "MIT", usage: "异步运行时" },
  { name: "reqwest", license: "MIT / Apache-2.0", usage: "WebDAV 网络请求" },
  { name: "chrono", license: "MIT / Apache-2.0", usage: "日期与时间" },
  {
    name: "chacha20poly1305 / argon2",
    license: "MIT / Apache-2.0",
    usage: "同步数据加密",
  },
];
