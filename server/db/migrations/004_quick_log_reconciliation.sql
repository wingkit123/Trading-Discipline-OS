ALTER TABLE trade_ideas ADD COLUMN quick_log_trade_id TEXT REFERENCES trade_ideas(id) ON DELETE SET NULL;
ALTER TABLE trade_ideas ADD COLUMN quick_log_booked_at TEXT;
CREATE INDEX idx_trade_ideas_linked_check_ins ON trade_ideas(quick_log_trade_id) WHERE quick_log_trade_id IS NOT NULL;
