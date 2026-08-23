import { AlertParser } from './alert_parser.js';
import { AlertDeduplicator } from './alert_dedup.js';
import { NormalizedAlert } from '../types/alert.types.js';
import { logger } from '../utils/logger.js';

export type AlertHandlerCallback = (alert: NormalizedAlert) => Promise<void>;

export class TelegramIngestionService {
  private deduplicator: AlertDeduplicator;
  private onAlertCallback?: AlertHandlerCallback;
  private isRunning: boolean = false;

  constructor(maxAlertAgeMs: number = 60000) {
    this.deduplicator = new AlertDeduplicator(maxAlertAgeMs);
  }

  /**
   * Registers callback to invoke when a valid, non-duplicate, fresh alert is accepted.
   */
  onAlert(callback: AlertHandlerCallback): void {
    this.onAlertCallback = callback;
  }

  /**
   * Ingests and processes a raw Telegram text message.
   */
  async processRawMessage(rawText: string, source: string = 'TELEGRAM', timestamp?: number): Promise<boolean> {
    const parseResult = AlertParser.parse(rawText, source, timestamp);
    if (!parseResult.valid || !parseResult.alert) {
      logger.warn({ rawText, reason: parseResult.rejectReason }, "Incoming Telegram message rejected: Invalid format/symbol.");
      return false;
    }

    const dedupResult = this.deduplicator.checkAndRecord(parseResult.alert);
    if (!dedupResult.accepted) {
      logger.warn({ alertId: parseResult.alert.alertId, symbol: parseResult.alert.symbol, reason: dedupResult.rejectReason }, "Incoming alert discarded by deduplicator/expiry check.");
      return false;
    }

    logger.info({ alertId: parseResult.alert.alertId, symbol: parseResult.alert.symbol }, "Incoming Telegram alert validated and admitted for strategy evaluation.");

    if (this.onAlertCallback) {
      try {
        await this.onAlertCallback(parseResult.alert);
      } catch (err: any) {
        logger.error({ err: err.message, alertId: parseResult.alert.alertId }, "Error occurred in downstream alert processing callback.");
      }
    }

    return true;
  }

  start(): void {
    this.isRunning = true;
    logger.info("Telegram Ingestion Service started.");
  }

  stop(): void {
    this.isRunning = false;
    logger.info("Telegram Ingestion Service stopped.");
  }
}
