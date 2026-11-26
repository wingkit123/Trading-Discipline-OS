# TASKS

## Milestone 1 — Core Journal & Discipline Loop
- [x] Scaffold, `.gitignore` (`data/` excluded), governance docs
- [x] Shared types + math (`x100` integer money, null-safe R-multiple, Layering budget, MYT trading week)
- [x] SQLite migrations (`001_init.sql`, `002_mt5_and_war_account.sql`), seed (2 accounts, SOP v1.0), WAL/FK, ZIP backup/restore
- [x] Attachment storage (magic-byte validation, SHA-256, traversal guard)
- [x] UI: Command Center, Journal (cards + daily rollup), SOP Center, Weekly Review, Settings/Backup, quick-log, trade editor

## Milestone 2 — Vantage MT5 Read-Only Sync & War Total-Capital Risk
- [x] Pure read-only MQL5 Service (`mt5/DisciplineOS_ReadOnlySync.mq5`) + Chinese setup guide (`mt5/README.md`)
- [x] Multi-format parser (`server/services/mt5-parser.ts`: UTF-16LE HTML/CSV, XLSX, `tdos-mt5-sync.v1` JSON)
- [x] Position reconstruction, Layering basket auto-clustering, `lot_escalation_detected`, `weighted_avg_entry`, `entry_span_pips`, merge & split (`server/services/mt5-cluster.ts`)
- [x] 5s `.unref()` file watcher (`server/services/mt5-watcher.ts`) + `MT5 同步` page
- [x] War Account `total_capital` risk basis + same-day `refill_after_loss_alert`

## Milestone 3 — Pi-Style AI Coach Provider Registry
- [x] Strict JSON Schema & `cited_trade_ids` grounding (`server/ai/schema.ts`, `prompt-builder.ts`)
- [x] Provider registry (`agy-cli`, `codex-cli`, `claude-cli`, custom OpenAI-compatible endpoints, `manual-export`) in `server/ai/provider-registry.ts`
- [x] Weekly Review AI Coach UI with clickable trade citations & one-click `#1 Focus` adoption

## Verification
- [x] `npm run typecheck` (exit 0)
- [x] `npm test` (44/44 pass, 0 fail)
- [x] `npm run build` (exit 0)
- [x] Responsive QA across desktop, tablet, and phone viewports (0 console errors, 0 horizontal overflow)

## Milestone 4 — Review Efficiency, Excel Journal Import & AI Co-Review
- [x] Migration `003_review_v02.sql` (`daily_sessions` self-reported P&L & source, `weekly_reviews` 3-question fields, `ai_trade_drafts`, `weekly_ai_messages`)
- [x] Shared XLSX workbook reader (`server/services/xlsx-reader.ts`, self-closing `<c .../>` fix) & Excel journal importer (`server/services/excel-journal-import.ts`)
- [x] Idempotent Excel journal import preview & commit with currency guard
- [x] TradeEditor review mode (FactStrip, daily note, AI draft panel, 3-question summary, auto `reviewed`, FACT protection, sticky footer) & Command Center `LayeringBudgetCard` + weekly reminder banner
- [x] Journal review queues (`复盘本周未复盘` / `最大亏损优先`) & `复盘日记` view
- [x] Weekly Review 3-question summary, AI trade drafts (`ai-drafts`), and multi-turn AI coach chat (`ai-chat`)

## Milestone 5 — v0.3 Engaging UX, Modal Draft Persistence & Cost-Effective `agy-cli` Routing
- [x] Cost-effective `agy-cli` task routing (`weekly_coach` → `gemini-4-argon-medium`, `trade_drafts` / `weekly_chat` → `gemini-3.8-flash-medium`) + fix `--model <suffixed> + --effort` CLI crash (`resolveAgyCliInvocation`)
- [x] Viewport-locked Modal with sticky header (`X` always reachable) & footer, backdrop click-outside + `Escape`, `localStorage` temp draft auto-save/recovery, and Confirm Exit dialog (`Modal.tsx`, `TradeEditor.tsx`, `QuickLogModal.tsx`, `draftStorage.ts`)
- [x] Global Toast feedback system (`Toast.tsx`) & Quick Reflection Chips + Live Review Completeness Meter (`X/4`)
- [x] Command Center Discipline Pulse (30-day SVG compliance ring, active streak, review progress, Edgewonk-style 10-trade Tiltmeter)
- [x] Journal Monthly P&L & Discipline Calendar Heatmap (`日历热力图`) + KPI strip + `草稿` row badge
- [x] Weekly Review What-If Discipline Simulator (`DisciplineSimulatorCard.tsx` + `simulateDisciplineScenario`) & AI Coach model presets / live timer
- [x] Unit tests (`server/tests/v03-ux-and-ai-routing.test.ts`), `npm run typecheck`, `npm test` (25/25 pass), `npm run build`, and live `agent-browser` QA

## Ledger and Workflow Review

- [x] MT5 account identity, incremental reconstruction, realized P&L by deal and read-only audit
- [x] Quick check-in review queue and ledger reconciliation
- [x] Risk alert chronology and SOP evidence coverage
- [x] Daily workflow, six-page responsive QA and offline calendar states
- [x] Loopback binding and password-protected phone mode, verified against a local HTTP fixture
