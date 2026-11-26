ALTER TABLE accounts ADD COLUMN total_capital_x100 INTEGER;
ALTER TABLE accounts ADD COLUMN risk_cap_basis TEXT NOT NULL DEFAULT 'total_capital';
ALTER TABLE accounts ADD COLUMN mt5_watch_path TEXT;
ALTER TABLE accounts ADD COLUMN mt5_watch_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN mt5_last_sync_at TEXT;
ALTER TABLE accounts ADD COLUMN mt5_last_balance_x100 INTEGER;
ALTER TABLE accounts ADD COLUMN mt5_last_equity_x100 INTEGER;
ALTER TABLE accounts ADD COLUMN mt5_is_investor_readonly INTEGER;
ALTER TABLE trade_ideas ADD COLUMN data_source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE trade_ideas ADD COLUMN weighted_avg_entry REAL;

CREATE TABLE IF NOT EXISTS mt5_sync_logs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  source_label TEXT NOT NULL,
  deals_seen INTEGER NOT NULL DEFAULT 0,
  deals_inserted INTEGER NOT NULL DEFAULT 0,
  deals_skipped_dup INTEGER NOT NULL DEFAULT 0,
  baskets_created INTEGER NOT NULL DEFAULT 0,
  baskets_updated INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mt5_sync_logs_account ON mt5_sync_logs(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mt5_deals_idea ON mt5_deals(trade_idea_id);
