/**
 * Ingestion layer alert types.
 * Isolated from Telegram-specific mechanics.
 */

export interface NormalizedAlert {
  /** Unique deterministic or UUID identifier for deduplication */
  alertId: string;
  /** Normalized trading pair symbol (e.g. "BTCUSDT") */
  symbol: string;
  /** Milliseconds epoch timestamp when alert was generated */
  timestamp: number;
  /** Alert source identifier (e.g. "TELEGRAM_CHANNEL_1") */
  source: string;
  /** Raw unparsed alert text for audit logging */
  rawText: string;
  /** Optional metadata extracted from alert */
  metadata?: {
    direction?: 'LONG' | 'SHORT';
    atr14?: number;
    [key: string]: any;
  };
}

export type AlertAdmissionStatus = 
  | 'PENDING'
  | 'ADMITTED'
  | 'REJECTED_VELOCITY'
  | 'REJECTED_MARGIN'
  | 'REJECTED_COOLDOWN'
  | 'REJECTED_DUPLICATE'
  | 'REJECTED_INVALID_SYMBOL'
  | 'EXPIRED';

export interface AlertValidationResult {
  valid: boolean;
  alert?: NormalizedAlert;
  rejectReason?: string;
}
