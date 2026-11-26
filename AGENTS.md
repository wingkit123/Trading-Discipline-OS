# AGENTS.md — Trading Discipline OS

## Purpose
Local-first XAUUSD trading journal and SOP discipline coach. Recording, review and discipline support only.

## Hard guardrails
- No trading execution: never place/close orders, modify SL/TP, change size, or hold trading credentials. Any MT5 integration is read-only.
- Local-first: no cloud sync, telemetry, or external network calls in core usage. Server binds to 127.0.0.1 only.
- `data/` (SQLite, screenshots, backups) must never be committed. Never expose account details.
- Never invent risk, prices, or P&L. Unknown values stay `null` / `N/A`. Do not mix currencies (USC vs USD).
- Self-reported fields (emotion, compliance) are observations, not proof of causation.

## Working rules
- One writer per worktree. Verify with `npm run typecheck`, `npm test`, `npm run build` before claiming completion.
- Money is stored as integer hundredths (`*_x100`).
- Locked pre-trade plans are immutable; changes go through amendments.
- This project is independent of XAUUSD-SNR-Agent, Trading View PineScript, PineScript-Indicators; do not modify them.
