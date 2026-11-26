# Vantage MT5 只读同步安装说明（Investor / View-Only 观摩模式）

本目录下的 `DisciplineOS_ReadOnlySync.mq5` 是一个 **100% 只读的 MQL5 Service（后台服务）**：
- **零交易代码**：不包含任何 `OrderSend`、`CTrade` 或 DLL 调用。
- **支持只读观摩密码（Investor Password）**：你可以在手机端用主密码正常做单，电脑端 Vantage MT5 只登录 **Investor 只读观摩密码**，既安全又能把已平仓成交、佣金（Commission）、隔夜息（Swap）和账户余额自动写入本地 JSON 文件。
- **不占用任何图表**：作为 MT5 Service 在后台静默运行，无需开图表，也无需开启“算法交易（Algo Trading）”。

## 手动启用步骤（4 步）

1. **打开 Vantage MT5 数据目录**：
   - 在电脑端 Vantage MT5 点击顶部菜单 `文件 (File)` → `打开数据文件夹 (Open Data Folder)`，进入 `MQL5\Services\`。
   - （Windows MT5 默认数据路径通常为：`C:\Users\<YourUsername>\AppData\Roaming\MetaQuotes\Terminal\<TERMINAL_ID>\MQL5\Services\`）
2. **复制并编译**：
   - 将本项目里的 `mt5\DisciplineOS_ReadOnlySync.mq5` 复制到上述 `MQL5\Services\` 目录。
   - 打开 MetaEditor（F4），打开 `DisciplineOS_ReadOnlySync.mq5`，按 `F7` 编译生成 `.ex5`（应为 `0 errors`）。
3. **在 MT5 中启动只读服务**：
   - 回到 MT5 左侧 `导航 (Navigator)` → 展开 `服务 (Services)` → 右键 `DisciplineOS_ReadOnlySync` → 点击 `开始 (Start)`。
   - 约 10 秒内，服务会在 `MQL5\Files\discipline-os-sync.json` 生成最新的成交与余额快照。
4. **在 Trading Discipline OS 中启用监听**：
   - 打开本应用的 `MT5 同步` 页面，点击 `填充本机 Vantage MT5 默认路径`（或粘贴你的 `MQL5\Files\discipline-os-sync.json` 完整路径），打开自动监听开关即可。
   - 之后只要电脑端 MT5 开着，手机平仓后约 10–15 秒内会自动归并 Layering Basket 并更新扣佣后的 Net P&L。
   - 如果某天电脑没开 MT5，也可直接从 MT5 导出历史报告（HTML / CSV / XLSX），拖入 `MT5 同步` 页面一键导入，按 `deal_ticket` 自动去重。
