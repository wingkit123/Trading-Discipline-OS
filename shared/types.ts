export type AccountRole = 'main' | 'war' | 'demo' | 'other';
export type CurrencyCode = 'USC' | 'USD' | 'MYR' | 'EUR' | 'OTHER';
export type CashflowType =
  | 'deposit'
  | 'withdrawal'
  | 'transfer_in'
  | 'transfer_out'
  | 'profit_sweep_out'
  | 'profit_sweep_in';
export type RuleSeverity = 'critical' | 'warning' | 'process';
export type DecisionSource = 'self' | 'signal' | 'signal_modified';
export type LifecycleStatus = 'planned' | 'open' | 'scaling' | 'closed';
export type ReviewStatus = 'unreviewed' | 'quick_logged' | 'reviewed';
export type CaptureTiming = 'pre_trade' | 'post_trade_backfill';
export type ComplianceLevel = 'compliant' | 'minor_deviation' | 'critical_breach' | 'na' | 'unknown';
export type EpistemicTag = 'FACT' | 'SELF_REPORTED' | 'INFERENCE' | 'UNKNOWN';
export type AttachmentStage = 'before' | 'during' | 'after';
export type HtfBias = 'bullish' | 'bearish' | 'range' | 'unclear';
export type Direction = 'buy' | 'sell';
export type RiskCapBasis = 'total_capital' | 'account_balance';
export type TradeDataSource = 'manual' | 'mt5_report' | 'mt5_live_sync';

export const CASHFLOW_SIGN: Record<CashflowType, 1 | -1> = {
  deposit: 1,
  withdrawal: -1,
  transfer_in: 1,
  transfer_out: -1,
  profit_sweep_in: 1,
  profit_sweep_out: -1,
};

export interface Account {
  id: string;
  broker: string;
  label: string;
  role: AccountRole;
  account_type: string;
  currency: CurrencyCode;
  default_symbol: string;
  pip_size: number;
  pip_value_per_lot: number;
  initial_balance_x100: number;
  capital_share_pct: number | null;
  daily_loss_cap_pct: number;
  single_idea_risk_cap_pct: number;
  profit_lock_soft_pct: number | null;
  mt5_login: string | null;
  is_active: boolean;
  total_capital_x100: number | null;
  risk_cap_basis: RiskCapBasis;
  mt5_watch_path: string | null;
  mt5_watch_enabled: boolean;
  mt5_last_sync_at: string | null;
  mt5_last_balance_x100: number | null;
  mt5_last_equity_x100: number | null;
  mt5_is_investor_readonly: boolean | null;
}

export interface Cashflow {
  id: string;
  account_id: string;
  type: CashflowType;
  amount_x100: number;
  note: string | null;
  occurred_at: string;
}

export interface SopRule {
  id?: string;
  code: string;
  category: string;
  severity: RuleSeverity;
  title: string;
  rationale: string;
  sort_order: number;
  is_enabled: boolean;
}

export interface SopVersion {
  id: string;
  version_number: number;
  title: string;
  changelog: string | null;
  is_active: boolean;
  created_at: string;
  rules: SopRule[];
}

export interface DailySession {
  id: string;
  account_id: string;
  trade_date_myt: string;
  has_high_impact_news: boolean;
  news_note: string | null;
  is_ldr_or_month_edge: boolean;
  htf_bias: HtfBias;
  pre_emotion: string | null;
  is_no_trade_day: boolean;
  daily_note: string | null;
  tomorrow_reminder: string | null;
  self_reported_pnl_x100: number | null;
  note_source: string | null;
}

export interface PlanSnapshot {
  symbol: string;
  direction: Direction;
  decision_source: DecisionSource;
  setup_type: string | null;
  timeframe: string | null;
  planned_entry: number | null;
  invalidation_price: number | null;
  target_price: number | null;
  planned_risk_x100: number | null;
  planned_layers: number | null;
  rule_override_acknowledged: boolean;
  rule_override_reason: string | null;
  locked_at: string;
}

export interface TradeIdea {
  id: string;
  account_id: string;
  sop_version_id: string;
  symbol: string;
  direction: Direction;
  decision_source: DecisionSource;
  setup_type: string | null;
  timeframe: string | null;
  lifecycle_status: LifecycleStatus;
  review_status: ReviewStatus;
  capture_timing: CaptureTiming;
  plan_snapshot: PlanSnapshot | null;
  plan_locked_at: string | null;
  planned_entry: number | null;
  invalidation_price: number | null;
  target_price: number | null;
  planned_risk_x100: number | null;
  planned_layers: number | null;
  rule_override_acknowledged: boolean;
  rule_override_reason: string | null;
  actual_layers: number | null;
  total_lots: number | null;
  entry_span_pips: number | null;
  lot_escalation_detected: boolean;
  max_adverse_pips: number | null;
  peak_float_dd_pct: number | null;
  gross_pnl_x100: number | null;
  commission_x100: number;
  swap_x100: number;
  net_pnl_x100: number | null;
  r_multiple: number | null;
  compliance_risk: ComplianceLevel;
  compliance_entry: ComplianceLevel;
  compliance_mgmt: ComplianceLevel;
  violated_rule_codes: string[];
  emotions_pre: string[];
  emotions_during: string[];
  emotions_after: string[];
  what_went_well: string | null;
  biggest_mistake: string | null;
  next_improvement: string | null;
  review_notes: string | null;
  is_bad_day_quick_log: boolean;
  quick_log_trade_id: string | null;
  quick_log_booked_at: string | null;
  data_source: TradeDataSource;
  weighted_avg_entry: number | null;
  opened_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TradeAmendment {
  id: string;
  trade_idea_id: string;
  reason: string;
  content: string;
  created_at: string;
}

export interface Attachment {
  id: string;
  trade_idea_id: string;
  stage: AttachmentStage;
  relative_path: string;
  original_name: string | null;
  mime_type: string;
  byte_size: number;
  sha256: string;
  caption: string | null;
  created_at: string;
}

export type SopStatus = 'followed' | 'violated' | 'partial' | 'unknown' | 'unreviewed';
export type OutcomeBucket = 'profitable' | 'losing' | 'breakeven' | 'unknown';

export interface MatrixCell {
  count: number;
  net_pnl_x100: number;
}

export interface WeeklyReviewSummary {
  week_key: string;
  week_start_utc: string;
  week_end_utc: string;
  currency: CurrencyCode;
  total_ideas: number;
  reviewed_ideas: number;
  unreviewed_ideas: number;
  net_pnl_x100: number;
  matrix: {
    followed_win: MatrixCell;
    followed_loss: MatrixCell;
    violated_win: MatrixCell;
    violated_loss: MatrixCell;
    breakeven: MatrixCell;
    partial: MatrixCell;
    unknown: MatrixCell;
    unreviewed: MatrixCell;
  };
  by_source: Array<{
    source: DecisionSource;
    n: number;
    net_pnl_x100: number;
    critical_breach_count: number;
    sample_size_warning: boolean;
  }>;
  top_losses: Array<{ id: string; opened_at: string; net_pnl_x100: number; decision_source: DecisionSource }>;
  survivor_bias_wins: Array<{ id: string; opened_at: string; net_pnl_x100: number; reason: string }>;
  violated_rules: Array<{ code: string; count: number }>;
  emotions: Array<{ tag: string; count: number }>;
  saved_review: {
    what_went_well: string | null;
    biggest_mistake: string | null;
    main_lessons: string | null;
    next_week_focus: string | null;
    ai_provider: string | null;
    ai_review: WeeklyAiCoachingOutput | null;
  } | null;
}

export interface BackupManifest {
  app: 'trading-discipline-os';
  version: 1;
  exported_at: string;
  db_sha256: string;
  screenshot_count: number;
}

export type DealSide = 'buy' | 'sell';
export type DealEntryKind = 'in' | 'out' | 'inout';

export interface Mt5Deal {
  deal_ticket: string;
  position_id: string | null;
  symbol: string;
  side: DealSide;
  entry_kind: DealEntryKind;
  volume: number;
  price: number;
  profit_x100: number;
  commission_x100: number;
  swap_x100: number;
  fee_x100: number;
  deal_time_utc: string;
  comment?: string | null;
}

export interface Mt5DetectedCashflow {
  deal_ticket: string;
  type: 'deposit' | 'withdrawal';
  amount_x100: number;
  occurred_at: string;
  comment: string | null;
}

export interface Mt5FeedPayload {
  schema: 'tdos-mt5-sync.v1';
  exported_at_utc: string;
  account_login: string | null;
  broker: string | null;
  currency: string | null;
  trade_allowed: boolean | null;
  balance: number | null;
  equity: number | null;
  open_positions_count: number | null;
}

export interface ParsedMt5Batch {
  format: 'json' | 'xlsx' | 'html' | 'csv';
  currency: string | null;
  login: string | null;
  live: { balance_x100: number | null; equity_x100: number | null; trade_allowed: boolean | null } | null;
  deals: Mt5Deal[];
  cashflows: Mt5DetectedCashflow[];
  warnings: string[];
}

export interface Mt5BasketPreview {
  symbol: string;
  side: DealSide;
  opened_at: string;
  closed_at: string;
  actual_layers: number;
  total_lots: number;
  weighted_avg_entry: number | null;
  entry_span_pips: number | null;
  lot_escalation_detected: boolean;
  gross_pnl_x100: number;
  commission_x100: number;
  swap_x100: number;
  net_pnl_x100: number;
  deal_tickets: string[];
  attaches_to_trade_idea_id: string | null;
}

export interface Mt5ImportPreview {
  currency_mismatch: boolean;
  login_mismatch: boolean;
  login_verified: boolean;
  parsed_currency: string | null;
  account_currency: string;
  deals_seen: number;
  new_deals: number;
  duplicate_deals: number;
  open_positions_ignored: number;
  incomplete_positions: number;
  baskets: Mt5BasketPreview[];
  cashflows: Mt5DetectedCashflow[];
  warnings: string[];
}

export interface Mt5LedgerAudit {
  checked_positions: number;
  issues: number;
  examples: { reference: string; issue: 'incomplete' | 'open_linked' | 'split' | 'missing_link' }[];
}

export interface Mt5SyncLog {
  id: string;
  account_id: string;
  channel: string;
  source_label: string;
  deals_seen: number;
  deals_inserted: number;
  deals_skipped_dup: number;
  baskets_created: number;
  baskets_updated: number;
  status: string;
  error_message: string | null;
  created_at: string;
}

export type AiTaskType = 'weekly_coach' | 'trade_drafts' | 'weekly_chat';
export type AiCoachEffort = 'low' | 'medium' | 'high' | 'xhigh';

export interface AiModelPreset {
  id: string;
  label: string;
  tier: 'fast' | 'balanced' | 'deep';
  note: string;
}

export interface AiModelFamily {
  familyId: string;
  displayName: string;
  vendor: 'gemini' | 'claude' | 'openai' | 'other';
  variants: Array<{ effort: AiCoachEffort | null; modelId: string }>;
  note?: string;
  recommendedFor?: AiTaskType[];
}

export interface AiCoachPreferences {
  provider: string;
  familyId: string;
  effort: AiCoachEffort;
  customModel: string;
}

export interface CustomAiEndpoint {
  id: string;
  name: string;
  baseUrl: string;
  defaultModel: string;
  hasApiKey: boolean;
  apiKeyMasked?: string;
}

export interface AiProviderInfo {
  id: string;
  displayName: string;
  description: string;
  kind?: 'cli' | 'custom_endpoint' | 'manual';
  customCliPath?: string | null;
  installCommand?: string;
  setupGuideUrl?: string;
  customEndpoint?: CustomAiEndpoint;
  defaultModels: string[];
  recommendedModels?: Record<AiTaskType, string>;
  modelOptions?: AiModelPreset[];
  modelFamilies?: AiModelFamily[];
  modelsFetchedAt?: string | null;
  supportsEffort: boolean;
  available: boolean;
  binaryPath?: string;
  note: string;
}

export interface DisciplineSimulatorRules {
  excludeCriticalBreach: boolean;
  excludeLotEscalation: boolean;
  maxLayersCap: number | null;
  stopAfterConsecutiveLosses: number | null;
}

export interface DisciplineSimulatorPoint {
  id: string;
  opened_at: string;
  actualCumX100: number;
  simulatedCumX100: number;
  excluded: boolean;
  reasons: string[];
}

export interface DisciplineSimulatorResult {
  totalTrades: number;
  keptTrades: number;
  excludedTrades: number;
  actualTotalX100: number;
  simulatedTotalX100: number;
  deltaX100: number;
  actualMaxDrawdownX100: number;
  simulatedMaxDrawdownX100: number;
  curve: DisciplineSimulatorPoint[];
}

export type EconomicNewsImpact = 'High' | 'Medium' | 'Low' | 'Holiday';

export interface EconomicNewsEvent {
  title: string;
  country: string;
  date: string;
  myt_time: string;
  trading_day: string;
  impact: EconomicNewsImpact;
  forecast: string;
  previous: string;
}

export interface LdrStatus {
  status: 'today' | 'window_before' | 'window_after' | 'upcoming' | 'none';
  matched_date: string | null;
  next_date: string | null;
  days_until_next: number | null;
}

export interface PreSessionChecklistItem {
  id: string;
  category: 'news' | 'ldr' | 'calendar' | 'reminder' | 'discipline';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail?: string;
}

export interface PreSessionBrief {
  today_myt: string;
  ldr: LdrStatus;
  is_month_edge: boolean;
  month_edge_label: string | null;
  previous_reminder: { date: string; text: string } | null;
  news: {
    source: 'forexfactory';
    calendar_url: string;
    fetched_at: string | null;
    cached: boolean;
    stale: boolean;
    error: string | null;
    events: EconomicNewsEvent[];
    usd_high_count: number;
    suggested_news_note: string;
  };
  checklist: PreSessionChecklistItem[];
  suggested_gate: {
    has_high_impact_news: boolean;
    news_note: string;
    is_ldr_or_month_edge: boolean;
  };
}

export interface WeeklyAiCoachingOutput {
  epistemic_label: 'INFERENCE (AI)';
  provider: string;
  model: string | null;
  generated_at: string;
  executive_summary: string;
  went_well?: { text: string; cited_trade_ids: string[] };
  biggest_mistake?: { text: string; cited_trade_ids: string[] };
  behavior_patterns: Array<{
    title: string;
    severity: 'critical' | 'warning' | 'info';
    observation: string;
    cited_trade_ids: string[];
    evidence_type: 'FACT_CITED' | 'SELF_REPORTED_PATTERN';
  }>;
  dunning_kruger_check: {
    state_signal: 'overconfidence_risk' | 'valley_of_despair' | 'calibrated' | 'insufficient_data';
    warning: string;
    evidence: string;
  };
  war_account_risk_audit: { assessment: string; refill_risk_flag: boolean };
  sharp_questions_for_trader: string[];
  recommended_next_week_focus: { focus: string; rationale: string };
  evidence_gaps: string[];
  validation_warnings: string[];
}

export interface AiTradeDraft {
  id: string;
  trade_idea_id: string;
  provider: string;
  model: string | null;
  what_went_well: string | null;
  biggest_mistake: string | null;
  next_improvement: string | null;
  suggested_violated_rule_codes: string[];
  confidence: 'low' | 'medium' | 'high';
  basis: string | null;
  status: 'pending' | 'adopted' | 'dismissed';
  created_at: string;
  updated_at: string;
}

export interface WeeklyAiMessage {
  id: string;
  account_id: string;
  week_key: string;
  role: 'user' | 'assistant';
  content: string;
  provider: string | null;
  model: string | null;
  created_at: string;
}

export interface ExcelJournalPreview {
  currency: string | null;
  dated_rows: number;
  daily_notes: number;
  self_reported_days: number;
  weekly_summaries: number;
  daily_new: number;
  daily_append: number;
  daily_unchanged: number;
  weekly_new: number;
  weekly_append: number;
  weekly_unchanged: number;
  samples: Array<{ date: string; note_excerpt: string; pnl_x100: number | null }>;
  weekly: Array<{ week_key: string; anchor_date: string; excerpt: string }>;
  warnings: string[];
}
