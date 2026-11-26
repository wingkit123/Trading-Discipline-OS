ALTER TABLE daily_sessions ADD COLUMN self_reported_pnl_x100 INTEGER;
ALTER TABLE daily_sessions ADD COLUMN note_source TEXT;
ALTER TABLE weekly_reviews ADD COLUMN what_went_well TEXT;
ALTER TABLE weekly_reviews ADD COLUMN biggest_mistake TEXT;

CREATE TABLE IF NOT EXISTS ai_trade_drafts (
  id TEXT PRIMARY KEY,
  trade_idea_id TEXT NOT NULL REFERENCES trade_ideas(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT,
  what_went_well TEXT,
  biggest_mistake TEXT,
  next_improvement TEXT,
  suggested_violated_rule_codes_json TEXT NOT NULL DEFAULT '[]',
  confidence TEXT NOT NULL DEFAULT 'low',
  basis TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_trade_drafts_trade ON ai_trade_drafts(trade_idea_id, status);

CREATE TABLE IF NOT EXISTS weekly_ai_messages (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  week_key TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_weekly_ai_messages ON weekly_ai_messages(account_id, week_key, created_at);
