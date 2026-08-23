import { NormalizedAlert, AlertValidationResult } from '../types/alert.types.js';

export class AlertParser {
  /**
   * Parses and normalizes an incoming raw alert message from Telegram.
   * Extracts token/symbol information, validates format, and produces a NormalizedAlert.
   */
  static parse(rawText: string, source: string = 'TELEGRAM', customTimestamp?: number): AlertValidationResult {
    if (!rawText || typeof rawText !== 'string') {
      return { valid: false, rejectReason: 'EMPTY_RAW_TEXT' };
    }

    const trimmed = rawText.trim();
    if (trimmed.length === 0) {
      return { valid: false, rejectReason: 'EMPTY_RAW_TEXT' };
    }

    // Require explicit prefix ($SYMBOL, #SYMBOL, FLAGGED: SYMBOL, Token: SYMBOL, BUY SYMBOL, LONG SYMBOL)
    // OR explicit USDT contract pair suffix (e.g. BTCUSDT, SOL/USDT)
    const prefixedMatch = trimmed.match(/(?:\$|#|Token:\s*|FLAGGED:\s*|BUY\s+|LONG\s+|PAIR:\s*)([A-Za-z0-9]{2,10})\b/i);
    const usdtMatch = trimmed.match(/\b([A-Za-z0-9]{2,10})(?:USDT|\/USDT)\b/i);

    let rawSymbol: string | null = null;

    if (prefixedMatch && prefixedMatch[1]) {
      rawSymbol = prefixedMatch[1];
    } else if (usdtMatch && usdtMatch[1]) {
      rawSymbol = usdtMatch[1];
    }

    if (!rawSymbol) {
      return { valid: false, rejectReason: 'SYMBOL_NOT_FOUND' };
    }

    let baseSymbol = rawSymbol.toUpperCase();

    // Remove any accidental 'USDT' suffix if captured in base
    if (baseSymbol.endsWith('USDT') && baseSymbol.length > 4) {
      baseSymbol = baseSymbol.slice(0, -4);
    }

    // Normalized contract pair format (e.g. BTCUSDT)
    const normalizedPair = `${baseSymbol}USDT`;

    const timestamp = customTimestamp || Date.now();
    
    // Deterministic ID generation based on source, symbol, and 5-minute bucket for deduplication
    const timeBucket = Math.floor(timestamp / (5 * 60 * 1000));
    const deterministicAlertId = `alert_${source}_${normalizedPair}_${timeBucket}`;

    const alert: NormalizedAlert = {
      alertId: deterministicAlertId,
      symbol: normalizedPair,
      timestamp,
      source,
      rawText: trimmed,
      metadata: {
        rawSymbolExtracted: baseSymbol,
        timeBucket
      }
    };

    return {
      valid: true,
      alert
    };
  }
}
