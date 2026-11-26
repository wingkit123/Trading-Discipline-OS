CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  broker TEXT NOT NULL,
  label TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'main',
  account_type TEXT NOT NULL,
  currency TEXT NOT NULL,
  default_symbol TEXT NOT NULL DEFAULT 'XAUUSD.sc',
  pip_size REAL NOT NULL DEFAULT 0.1,
  pip_value_per_lot REAL NOT NULL DEFAULT 10.0,
  initial_balance_x100 INTEGER NOT NULL DEFAULT 0,
  capital_share_pct REAL,
  daily_loss_cap_pct REAL NOT NULL DEFAULT 25.0,
  single_idea_risk_cap_pct REAL NOT NULL DEFAULT 20.0,
  profit_lock_soft_pct REAL,
  mt5_login TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cashflows (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  amount_x100 INTEGER NOT NULL,
  note TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sop_versions (
  id TEXT PRIMARY KEY,
  version_number INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL,
  changelog TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sop_rules (
  id TEXT PRIMARY KEY,
  sop_version_id TEXT NOT NULL REFERENCES sop_versions(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  rationale TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS daily_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  trade_date_myt TEXT NOT NULL,
  has_high_impact_news INTEGER NOT NULL DEFAULT 0,
  news_note TEXT,
  is_ldr_or_month_edge INTEGER NOT NULL DEFAULT 0,
  htf_bias TEXT NOT NULL DEFAULT 'unclear',
  daily_loss_cap_x100 INTEGER,
  pre_emotion TEXT,
  is_no_trade_day INTEGER NOT NULL DEFAULT 0,
  daily_note TEXT,
  tomorrow_reminder TEXT,
  locked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, trade_date_myt)
);

CREATE TABLE IF NOT EXISTS trade_ideas (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sop_version_id TEXT NOT NULL REFERENCES sop_versions(id),
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL,
  decision_source TEXT NOT NULL,
  setup_type TEXT,
  timeframe TEXT,
  lifecycle_status TEXT NOT NULL DEFAULT 'planned',
  review_status TEXT NOT NULL DEFAULT 'unreviewed',
  capture_timing TEXT NOT NULL DEFAULT 'pre_trade',
  plan_snapshot_json TEXT,
  plan_locked_at TEXT,
  planned_entry REAL,
  invalidation_price REAL,
  target_price REAL,
  planned_risk_x100 INTEGER,
  planned_layers INTEGER,
  rule_override_acknowledged INTEGER NOT NULL DEFAULT 0,
  rule_override_reason TEXT,
  actual_layers INTEGER,
  total_lots REAL,
  entry_span_pips REAL,
  lot_escalation_detected INTEGER NOT NULL DEFAULT 0,
  max_adverse_pips REAL,
  peak_float_dd_pct REAL,
  gross_pnl_x100 INTEGER,
  commission_x100 INTEGER NOT NULL DEFAULT 0,
  swap_x100 INTEGER NOT NULL DEFAULT 0,
  net_pnl_x100 INTEGER,
  compliance_risk TEXT NOT NULL DEFAULT 'unknown',
  compliance_entry TEXT NOT NULL DEFAULT 'unknown',
  compliance_mgmt TEXT NOT NULL DEFAULT 'unknown',
  violated_rule_codes_json TEXT NOT NULL DEFAULT '[]',
  emotions_pre_json TEXT NOT NULL DEFAULT '[]',
  emotions_during_json TEXT NOT NULL DEFAULT '[]',
  emotions_after_json TEXT NOT NULL DEFAULT '[]',
  what_went_well TEXT,
  biggest_mistake TEXT,
  next_improvement TEXT,
  review_notes TEXT,
  is_bad_day_quick_log INTEGER NOT NULL DEFAULT 0,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mt5_deals (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  trade_idea_id TEXT REFERENCES trade_ideas(id) ON DELETE SET NULL,
  deal_ticket TEXT NOT NULL,
  position_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  entry_kind TEXT NOT NULL,
  volume REAL NOT NULL,
  price REAL NOT NULL,
  profit_x100 INTEGER NOT NULL,
  commission_x100 INTEGER NOT NULL DEFAULT 0,
  swap_x100 INTEGER NOT NULL DEFAULT 0,
  fee_x100 INTEGER NOT NULL DEFAULT 0,
  deal_time_utc TEXT NOT NULL,
  import_source TEXT NOT NULL,
  raw_payload_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(account_id, deal_ticket)
);

CREATE TABLE IF NOT EXISTS trade_amendments (
  id TEXT PRIMARY KEY,
  trade_idea_id TEXT NOT NULL REFERENCES trade_ideas(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  trade_idea_id TEXT NOT NULL REFERENCES trade_ideas(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  original_name TEXT,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  caption TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS weekly_reviews (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  week_key TEXT NOT NULL,
  week_start_utc TEXT NOT NULL,
  week_end_utc TEXT NOT NULL,
  deterministic_summary_json TEXT NOT NULL,
  main_lessons TEXT,
  next_week_focus TEXT,
  ai_provider TEXT,
  ai_review_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, week_key)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trade_ideas_account_opened ON trade_ideas(account_id, opened_at);
CREATE INDEX IF NOT EXISTS idx_cashflows_account_time ON cashflows(account_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_attachments_idea ON attachments(trade_idea_id);
CREATE INDEX IF NOT EXISTS idx_daily_sessions_account_date ON daily_sessions(account_id, trade_date_myt);
