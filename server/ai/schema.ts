import type { WeeklyAiCoachingOutput } from '../../shared/types.js';
import { ServiceError } from '../services/trade-service.js';

const CITED_TEXT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'cited_trade_ids'],
  properties: {
    text: { type: 'string' },
    cited_trade_ids: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const WEEKLY_COACH_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'executive_summary',
    'went_well',
    'biggest_mistake',
    'behavior_patterns',
    'dunning_kruger_check',
    'war_account_risk_audit',
    'sharp_questions_for_trader',
    'recommended_next_week_focus',
    'evidence_gaps',
  ],
  properties: {
    executive_summary: { type: 'string' },
    went_well: CITED_TEXT_SCHEMA,
    biggest_mistake: CITED_TEXT_SCHEMA,
    behavior_patterns: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'severity', 'observation', 'cited_trade_ids', 'evidence_type'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'warning', 'info'] },
          observation: { type: 'string' },
          cited_trade_ids: { type: 'array', items: { type: 'string' } },
          evidence_type: { type: 'string', enum: ['FACT_CITED', 'SELF_REPORTED_PATTERN'] },
        },
      },
    },
    dunning_kruger_check: {
      type: 'object',
      additionalProperties: false,
      required: ['state_signal', 'warning', 'evidence'],
      properties: {
        state_signal: {
          type: 'string',
          enum: ['overconfidence_risk', 'valley_of_despair', 'calibrated', 'insufficient_data'],
        },
        warning: { type: 'string' },
        evidence: { type: 'string' },
      },
    },
    war_account_risk_audit: {
      type: 'object',
      additionalProperties: false,
      required: ['assessment', 'refill_risk_flag'],
      properties: {
        assessment: { type: 'string' },
        refill_risk_flag: { type: 'boolean' },
      },
    },
    sharp_questions_for_trader: {
      type: 'array',
      items: { type: 'string' },
    },
    recommended_next_week_focus: {
      type: 'object',
      additionalProperties: false,
      required: ['focus', 'rationale'],
      properties: {
        focus: { type: 'string' },
        rationale: { type: 'string' },
      },
    },
    evidence_gaps: {
      type: 'array',
      items: { type: 'string' },
    },
  },
} as const;

export const TRADE_DRAFTS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['drafts'],
  properties: {
    drafts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'trade_id',
          'what_went_well',
          'biggest_mistake',
          'next_improvement',
          'suggested_violated_rule_codes',
          'confidence',
          'basis',
        ],
        properties: {
          trade_id: { type: 'string' },
          what_went_well: { type: 'string' },
          biggest_mistake: { type: 'string' },
          next_improvement: { type: 'string' },
          suggested_violated_rule_codes: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          basis: { type: 'string' },
        },
      },
    },
  },
} as const;

export function extractJsonObject(raw: string, markerKey = 'executive_summary'): Record<string, any> {
  const trimmed = raw.trim();
  if (!trimmed) throw new ServiceError('AI CLI 返回空内容', 502);

  const tryParse = (s: string): any => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };

  let parsed = tryParse(trimmed);
  if (!parsed) {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) parsed = tryParse(fenced[1].trim());
  }
  if (!parsed) {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) parsed = tryParse(trimmed.slice(start, end + 1));
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new ServiceError('无法从 AI 输出中解析有效的 JSON', 502);
  }

  for (const key of ['structured_output', 'result', 'response', 'output', 'content', 'text']) {
    if (typeof parsed[key] === 'string') {
      try {
        const inner = extractJsonObject(parsed[key], markerKey);
        if (inner && typeof inner === 'object' && markerKey in inner) return inner;
      } catch {
        /* continue checking other envelope keys */
      }
    } else if (parsed[key] && typeof parsed[key] === 'object' && markerKey in parsed[key]) {
      return parsed[key];
    }
  }
  return parsed;
}

function groundIds(rawIds: unknown, validTradeIds: Set<string>, warnings: string[]): string[] {
  const ids = Array.isArray(rawIds) ? rawIds.map(String) : [];
  const grounded: string[] = [];
  for (const id of ids) {
    if (validTradeIds.has(id)) grounded.push(id);
    else warnings.push(`已剔除 AI 虚构或越界引用的交易 ID：${id}`);
  }
  return grounded;
}

export function validateAndGroundCoachingOutput(
  rawText: string,
  validTradeIds: Set<string>,
  meta: { provider: string; model: string | null },
): WeeklyAiCoachingOutput {
  const obj = extractJsonObject(rawText, 'executive_summary');
  if (typeof obj.executive_summary !== 'string' || !Array.isArray(obj.behavior_patterns)) {
    throw new ServiceError('AI 输出缺少必需字段 (executive_summary / behavior_patterns)', 502);
  }

  const warnings: string[] = [];
  const patterns = obj.behavior_patterns.map((p: any) => ({
    title: String(p?.title ?? '行为模式'),
    severity: (['critical', 'warning', 'info'].includes(p?.severity) ? p.severity : 'info') as 'critical' | 'warning' | 'info',
    observation: String(p?.observation ?? ''),
    cited_trade_ids: groundIds(p?.cited_trade_ids, validTradeIds, warnings),
    evidence_type: (p?.evidence_type === 'FACT_CITED' ? 'FACT_CITED' : 'SELF_REPORTED_PATTERN') as
      | 'FACT_CITED'
      | 'SELF_REPORTED_PATTERN',
  }));

  const dk = obj.dunning_kruger_check ?? {};
  const war = obj.war_account_risk_audit ?? {};
  const rec = obj.recommended_next_week_focus ?? {};
  const wentWell = obj.went_well && typeof obj.went_well === 'object'
    ? { text: String(obj.went_well.text ?? ''), cited_trade_ids: groundIds(obj.went_well.cited_trade_ids, validTradeIds, warnings) }
    : undefined;
  const biggestMistake = obj.biggest_mistake && typeof obj.biggest_mistake === 'object'
    ? { text: String(obj.biggest_mistake.text ?? ''), cited_trade_ids: groundIds(obj.biggest_mistake.cited_trade_ids, validTradeIds, warnings) }
    : undefined;

  return {
    epistemic_label: 'INFERENCE (AI)',
    provider: meta.provider,
    model: meta.model,
    generated_at: new Date().toISOString(),
    executive_summary: String(obj.executive_summary),
    ...(wentWell ? { went_well: wentWell } : {}),
    ...(biggestMistake ? { biggest_mistake: biggestMistake } : {}),
    behavior_patterns: patterns,
    dunning_kruger_check: {
      state_signal: (['overconfidence_risk', 'valley_of_despair', 'calibrated', 'insufficient_data'].includes(dk.state_signal)
        ? dk.state_signal
        : 'insufficient_data') as WeeklyAiCoachingOutput['dunning_kruger_check']['state_signal'],
      warning: String(dk.warning ?? ''),
      evidence: String(dk.evidence ?? ''),
    },
    war_account_risk_audit: {
      assessment: String(war.assessment ?? ''),
      refill_risk_flag: Boolean(war.refill_risk_flag),
    },
    sharp_questions_for_trader: Array.isArray(obj.sharp_questions_for_trader)
      ? obj.sharp_questions_for_trader.map(String).slice(0, 5)
      : [],
    recommended_next_week_focus: {
      focus: String(rec.focus ?? ''),
      rationale: String(rec.rationale ?? ''),
    },
    evidence_gaps: Array.isArray(obj.evidence_gaps) ? obj.evidence_gaps.map(String) : [],
    validation_warnings: warnings,
  };
}

export interface ValidatedTradeDraft {
  trade_id: string;
  what_went_well: string;
  biggest_mistake: string;
  next_improvement: string;
  suggested_violated_rule_codes: string[];
  confidence: 'low' | 'medium' | 'high';
  basis: string;
}

export function validateTradeDrafts(
  rawText: string,
  validTradeIds: Set<string>,
  activeRuleCodes: Set<string>,
): { drafts: ValidatedTradeDraft[]; warnings: string[] } {
  const obj = extractJsonObject(rawText, 'drafts');
  if (!Array.isArray(obj.drafts)) {
    throw new ServiceError('AI 草稿输出缺少 drafts 数组', 502);
  }
  const warnings: string[] = [];
  const drafts: ValidatedTradeDraft[] = [];
  for (const d of obj.drafts) {
    const id = String(d?.trade_id ?? '');
    if (!validTradeIds.has(id)) {
      warnings.push(`已丢弃未知交易 ID 的草稿：${id || '(empty)'}`);
      continue;
    }
    const rawRules = Array.isArray(d?.suggested_violated_rule_codes) ? d.suggested_violated_rule_codes.map(String) : [];
    const rules = rawRules.filter((c: string) => activeRuleCodes.has(c));
    drafts.push({
      trade_id: id,
      what_went_well: String(d?.what_went_well ?? ''),
      biggest_mistake: String(d?.biggest_mistake ?? ''),
      next_improvement: String(d?.next_improvement ?? ''),
      suggested_violated_rule_codes: rules,
      confidence: (['low', 'medium', 'high'].includes(d?.confidence) ? d.confidence : 'low') as 'low' | 'medium' | 'high',
      basis: String(d?.basis ?? ''),
    });
  }
  return { drafts, warnings };
}
