import type { ComplianceLevel, DisciplineSimulatorPoint, DisciplineSimulatorResult, DisciplineSimulatorRules } from './types.js';
import type { TradeIdea } from './types.js';

export function needsTradeReview(trade: TradeIdea): boolean {
  return trade.lifecycle_status === 'closed' && !trade.quick_log_trade_id && trade.review_status !== 'reviewed';
}

export function isLedgerTrade(trade: TradeIdea): boolean {
  return trade.lifecycle_status === 'closed' && (!trade.is_bad_day_quick_log || (!!trade.quick_log_booked_at && !trade.quick_log_trade_id));
}

export function toX100(amount: number): number {
  return Math.round(amount * 100);
}

export function fromX100(x100: number): number {
  return x100 / 100;
}

/** Returns null whenever the initial risk is unknown; never invents a risk value. */
export function computeRMultiple(netPnlX100: number | null, plannedRiskX100: number | null): number | null {
  if (netPnlX100 === null || plannedRiskX100 === null || plannedRiskX100 <= 0) return null;
  return Math.round((netPnlX100 / plannedRiskX100) * 100) / 100;
}

export interface LayeringBudgetInput {
  balance: number;
  riskPct: number;
  slPips: number;
  layers: number;
  pipValuePerLot: number;
  touchAndGoPips?: number;
}

export interface LayeringBudget {
  maxRiskAmount: number;
  avgDistanceToSlPips: number;
  safeTotalLots: number;
  safePerLayerLots: number;
  layerDistancesToSl: number[];
  singleLayerTouchAndGoProfit: number;
  fullBasketSlLoss: number;
  profitToLossRatio: number | null;
}

/**
 * Layers are assumed evenly spaced from 0% to 85% of the SL distance (equal lots per layer).
 * This is a planning aid, not a trading instruction.
 */
export function computeLayeringBudget(p: LayeringBudgetInput): LayeringBudget | null {
  if (!(p.balance > 0) || !(p.riskPct > 0) || !(p.slPips > 0) || !(p.layers >= 1) || !(p.pipValuePerLot > 0)) {
    return null;
  }
  const maxRiskAmount = p.balance * (p.riskPct / 100);
  const layerDistancesToSl: number[] = [];
  for (let i = 0; i < p.layers; i++) {
    const frac = p.layers === 1 ? 0 : (0.85 * i) / (p.layers - 1);
    layerDistancesToSl.push(round1(p.slPips * (1 - frac)));
  }
  const sumDist = layerDistancesToSl.reduce((a, b) => a + b, 0);
  const avgDistanceToSlPips = round1(sumDist / p.layers);
  const safePerLayerLots = floor2(maxRiskAmount / (sumDist * p.pipValuePerLot));
  const safeTotalLots = round2(safePerLayerLots * p.layers);
  const touch = p.touchAndGoPips ?? 50;
  const singleLayerTouchAndGoProfit = round2(safePerLayerLots * touch * p.pipValuePerLot);
  const fullBasketSlLoss = round2(safePerLayerLots * sumDist * p.pipValuePerLot);
  return {
    maxRiskAmount: round2(maxRiskAmount),
    avgDistanceToSlPips,
    safeTotalLots,
    safePerLayerLots,
    layerDistancesToSl,
    singleLayerTouchAndGoProfit,
    fullBasketSlLoss,
    profitToLossRatio: fullBasketSlLoss > 0 ? round2(singleLayerTouchAndGoProfit / fullBasketSlLoss) : null,
  };
}

const MYT_OFFSET_MS = 8 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

export function toMytDate(isoUtc: string): string {
  return new Date(new Date(isoUtc).getTime() + MYT_OFFSET_MS).toISOString().slice(0, 10);
}

export function mytDateToday(now = new Date()): string {
  return toMytDate(now.toISOString());
}

/** Trading day = MYT date shifted back by cutoffHourMYT (default 06:00 MYT, matching broker EOD rollover). */
export function toTradingDayMYT(isoUtc: string, cutoffHourMYT = 6): string {
  return toMytDate(new Date(new Date(isoUtc).getTime() - cutoffHourMYT * 3600 * 1000).toISOString());
}

/** Convert Excel serial date (1900 date system) to YYYY-MM-DD. */
export function excelSerialToIsoDate(serial: number): string {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * DAY_MS).toISOString().slice(0, 10);
}

export interface TradingWeek {
  weekKey: string;
  weekStartUtc: string;
  weekEndUtc: string;
}

/**
 * Trading week = [cutoff day/hour MYT, same cutoff 7 days later). Default Saturday 06:00 MYT.
 * Malaysia has no DST so a fixed UTC+8 offset is exact.
 * weekKey is the MYT date (YYYY-MM-DD) of the week start.
 */
export function getTradingWeekKeyMYT(isoUtc: string, cutoffDayOfWeek = 6, cutoffHourMYT = 6): TradingWeek {
  const mytMs = new Date(isoUtc).getTime() + MYT_OFFSET_MS;
  const shifted = mytMs - cutoffHourMYT * 3600 * 1000;
  const shiftedDate = new Date(shifted);
  const dow = shiftedDate.getUTCDay();
  const daysBack = (dow - cutoffDayOfWeek + 7) % 7;
  const startShifted = Date.UTC(
    shiftedDate.getUTCFullYear(),
    shiftedDate.getUTCMonth(),
    shiftedDate.getUTCDate(),
  ) - daysBack * DAY_MS;
  const startMyt = startShifted + cutoffHourMYT * 3600 * 1000;
  const startUtc = startMyt - MYT_OFFSET_MS;
  return {
    weekKey: new Date(startMyt).toISOString().slice(0, 10),
    weekStartUtc: new Date(startUtc).toISOString(),
    weekEndUtc: new Date(startUtc + 7 * DAY_MS).toISOString(),
  };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
function round2(n: number) {
  return Math.round(n * 100) / 100;
}
function floor2(n: number) {
  return Math.floor(n * 100) / 100;
}

export interface SimulatorTradeInput {
  id: string;
  opened_at: string;
  net_pnl_x100: number | null;
  compliance_risk: ComplianceLevel;
  compliance_entry: ComplianceLevel;
  compliance_mgmt: ComplianceLevel;
  lot_escalation_detected: boolean;
  actual_layers: number | null;
}

/**
 * Deterministic post-hoc filter simulation on closed trades (integer *_x100).
 * Never invents prices or future returns.
 */
export function simulateDisciplineScenario(
  trades: SimulatorTradeInput[],
  rules: DisciplineSimulatorRules,
): DisciplineSimulatorResult {
  const closed = trades
    .filter((t): t is SimulatorTradeInput & { net_pnl_x100: number } => t.net_pnl_x100 !== null)
    .sort((a, b) => a.opened_at.localeCompare(b.opened_at));

  let actualCum = 0;
  let simulatedCum = 0;
  let actualPeak = 0;
  let simulatedPeak = 0;
  let actualMaxDd = 0;
  let simulatedMaxDd = 0;
  let keptTrades = 0;
  let excludedTrades = 0;

  let currentDay = '';
  let intradayLossStreak = 0;
  const curve: DisciplineSimulatorPoint[] = [];

  for (const t of closed) {
    const day = toTradingDayMYT(t.opened_at);
    if (day !== currentDay) {
      currentDay = day;
      intradayLossStreak = 0;
    }

    const reasons: string[] = [];
    if (
      rules.excludeCriticalBreach &&
      (t.compliance_risk === 'critical_breach' ||
        t.compliance_entry === 'critical_breach' ||
        t.compliance_mgmt === 'critical_breach')
    ) {
      reasons.push('严重违规');
    }
    if (rules.excludeLotEscalation && t.lot_escalation_detected) {
      reasons.push('手数膨胀');
    }
    if (rules.maxLayersCap !== null && t.actual_layers !== null && t.actual_layers > rules.maxLayersCap) {
      reasons.push(`层数 > ${rules.maxLayersCap}`);
    }
    if (rules.stopAfterConsecutiveLosses !== null && intradayLossStreak >= rules.stopAfterConsecutiveLosses) {
      reasons.push(`当日连亏 ${rules.stopAfterConsecutiveLosses} 笔后停手`);
    }

    const excluded = reasons.length > 0;
    actualCum += t.net_pnl_x100;
    if (actualCum > actualPeak) actualPeak = actualCum;
    actualMaxDd = Math.max(actualMaxDd, actualPeak - actualCum);

    if (excluded) {
      excludedTrades++;
    } else {
      keptTrades++;
      simulatedCum += t.net_pnl_x100;
      if (simulatedCum > simulatedPeak) simulatedPeak = simulatedCum;
      simulatedMaxDd = Math.max(simulatedMaxDd, simulatedPeak - simulatedCum);
    }

    if (t.net_pnl_x100 < 0) {
      intradayLossStreak++;
    } else {
      intradayLossStreak = 0;
    }

    curve.push({
      id: t.id,
      opened_at: t.opened_at,
      actualCumX100: actualCum,
      simulatedCumX100: simulatedCum,
      excluded,
      reasons,
    });
  }

  return {
    totalTrades: closed.length,
    keptTrades,
    excludedTrades,
    actualTotalX100: actualCum,
    simulatedTotalX100: simulatedCum,
    deltaX100: simulatedCum - actualCum,
    actualMaxDrawdownX100: actualMaxDd,
    simulatedMaxDrawdownX100: simulatedMaxDd,
    curve,
  };
}
