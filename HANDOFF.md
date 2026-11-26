# HANDOFF

## Current Status

- **Verification**: `npm run typecheck`, `npm test`, and `npm run build` pass cleanly.
- **Security & Privacy Guardrails**:
  - Core app listens on `127.0.0.1` by default; optional `-Tailscale` mode enables password-protected phone access with host/origin validation.
  - `data/` (SQLite database, screenshots, backups) is excluded by `.gitignore`.
  - MT5 integration is 100% read-only (`DisciplineOS_ReadOnlySync.mq5` contains zero `OrderSend` / trading APIs) and binds accounts strictly via `mt5_login` and currency checks.
- **Completed Capabilities**:
  - Command Center (Next Discipline Action, Interactive Equity Curve, 30-day Compliance Ring, 10-trade Tiltmeter, War Account Total-Capital Risk & Refill-After-Loss Alert, Pre-Session Check with ForexFactory cache + LDR 2026 notices).
  - Journal & Monthly P&L Calendar Heatmap, Check-in Reconciliation, Trade Editor (immutable pre-trade plan snapshots, amendments, Layering merge/split, local draft persistence).
  - Weekly Process-vs-Outcome Matrix, deterministic What-If Discipline Simulator, and Pi-style Local AI Coach (`agy-cli`, `codex-cli` dynamic cache discovery, `claude-cli`, custom OpenAI-compatible endpoints, `manual-export`).
  - Self-contained 60s Brand & Product Promo Video pipeline in `promo-video/`.

## Quick Start
- Launch local server: `.\start-discipline-os.ps1` -> `http://127.0.0.1:4173`
- Dev HMR mode: `.\start-discipline-os.ps1 -Dev` -> `http://127.0.0.1:5173`
