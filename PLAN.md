# PLAN

## Goal
A personal Local-First XAUUSD trading discipline system: pre-session gate, trade ideas with immutable pre-trade snapshots, SOP versioning, MT5 read-only dual-channel sync & Layering auto-clustering, weekly process-vs-outcome review, and Pi-style CLI AI Coach.

## Decisions
- Stack: React 18 + TypeScript + Vite, Node 22 + Express, `node:sqlite` (zero native addons), screenshots as local files with DB references.
- War Account Total-Capital Risk Model: `10–20%` per round & `20–25%` daily cap are evaluated against **Total Capital** (`risk_cap_basis = 'total_capital'`). Main allocates ~20% into War Account; same-day refill after big War loss triggers `refill_after_loss_alert`.
- MT5 Read-Only Dual-Channel Sync: Python `MetaTrader5` wheels stop at cp314 vs local Python 3.15, so pure Node 22 handles (A) near-real-time local JSON watcher (`mt5/DisciplineOS_ReadOnlySync.mq5` pure read-only service, zero `OrderSend`) and (B) drag-and-drop HTML/CSV/XLSX/JSON report import with `deal_ticket` deduplication & Layering basket auto-clustering.
- AI Coach: Pi-style pluggable `AiProviderRegistry` (`agy-cli`, `codex-cli`, `claude-cli`, custom OpenAI-compatible endpoints, `manual-export`) using non-interactive CLI flags, strict JSON Schema grounding (`cited_trade_ids` verified against real week trades), and `INFERENCE (AI)` labeling. Deterministic stats remain 100% independent of AI.

## Milestones
1. Core journal, SOP, pre-session gate, weekly review, backup — **DONE**
2. MT5 read-only sync, Layering auto-cluster, War total-capital risk & refill alert — **DONE**
3. Pi-style CLI AI Coach provider registry & Weekly Review integration — **DONE**

## Discipline Ledger and Daily Workflow

- Rebuild affected MT5 positions from stored and incoming deals. Identify partial, incomplete and mismatched data in the import preview and a read-only audit.
- Keep loss check-ins visible in review. Confirm a standalone amount or link the check-in to an MT5 card before it affects the ledger.
- Calculate the day's first recorded loss-limit breach and check the timing of subsequent funding. Keep the configured thresholds and read-only MT5 integration.
- Put the next discipline action near the top of the dashboard. Verify the journal, sync, and review flows on desktop, tablet, and phone layouts.
- Keep the listener on loopback. Require access control for opt-in phone access and make calendar lookup explicit.
