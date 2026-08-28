import { NormalizedAlert } from '../types/alert.types.js';
import { logger } from '../utils/logger.js';
import { ENV } from '../config/env.js';

export type AlertHandlerCallback = (alert: NormalizedAlert) => Promise<void>;

interface MexcTicker {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  prevClosePrice: string;
  lastPrice: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openTime: number;
  closeTime: number;
  count: number;
}

export class MexcScannerService {
  private onAlertCallback?: AlertHandlerCallback;
  private isRunning: boolean = false;
  private timer?: NodeJS.Timeout;
  private scanIntervalMs: number;
  
  constructor(scanIntervalSeconds: number = 300) {
    this.scanIntervalMs = scanIntervalSeconds * 1000;
  }

  onAlert(callback: AlertHandlerCallback): void {
    this.onAlertCallback = callback;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info("MEXC Stage 1 Scanner Service started.");
    
    // Run immediately, then schedule
    this.runScanCycle().catch(err => {
      logger.error({ err: err.message }, "Error during initial MEXC scan cycle.");
    });
    
    this.timer = setInterval(() => {
      this.runScanCycle().catch(err => {
        logger.error({ err: err.message }, "Error during MEXC scan cycle.");
      });
    }, this.scanIntervalMs);
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    logger.info("MEXC Stage 1 Scanner Service stopped.");
  }

  private async runScanCycle(): Promise<void> {
    if (!this.isRunning) return;
    logger.info("Starting MEXC Universe Scan...");

    try {
      // 1. Fetch Tickers
      const res = await fetch('https://api.mexc.com/api/v3/ticker/24hr');
      if (!res.ok) {
        throw new Error(`Failed to fetch tickers: ${res.statusText}`);
      }
      const tickers: MexcTicker[] = await res.json();

      // 2. Build Universe
      const universe = this.buildUniverse(tickers);
      logger.info({ universeSize: universe.length }, "MEXC Universe built.");

      // 3. Process each candidate
      for (const ticker of universe) {
        if (!this.isRunning) break;
        
        try {
          const isEligible = await this.evaluateCandidate(ticker);
          if (isEligible && this.onAlertCallback) {
            const alertId = `alert_MEXC_${ticker.symbol}_${Math.floor(Date.now() / (5 * 60 * 1000))}`;
            const alert: NormalizedAlert = {
              alertId,
              symbol: ticker.symbol,
              timestamp: Date.now(),
              source: 'MEXC_SCANNER',
              rawText: `MEXC Scanner Alert: Stage 1 detected for ${ticker.symbol}`,
              metadata: {
                rawSymbolExtracted: ticker.symbol.replace('USDT', ''),
                quoteVolume: ticker.quoteVolume,
                lastPrice: ticker.lastPrice
              }
            };
            
            await this.onAlertCallback(alert);
          }
        } catch (err: any) {
          logger.debug({ err: err.message, symbol: ticker.symbol }, "Failed to evaluate candidate.");
        }
        
        // Minor delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      logger.info("MEXC Universe Scan complete.");
    } catch (error: any) {
      logger.error({ err: error.message }, "Scan cycle failed.");
    }
  }

  private buildUniverse(tickers: MexcTicker[]): MexcTicker[] {
    const invalidSuffixes = ['3L', '3S', '5L', '5S', 'DOWN', 'UP', 'BEAR', 'BULL'];
    const stablecoins = ['USDCUSDT', 'BUSDUSDT', 'TUSDUSDT', 'DAIUSDT', 'EURUSDT'];
    const blacklist = [
      "SN85", "SN64", "BOSON", "EUR", "NOS",
      "ALEO", "TLOS", "XMR", "EIGEN", "FAR",
      "TTMION", "ROAM", "NOCON", "NAVX", "INODON",
      "NEMON", "FON", "GOATED"
    ];
    
    let filtered = tickers.filter(t => {
      if (!t.symbol.endsWith('USDT')) return false;
      if (stablecoins.includes(t.symbol)) return false;

      const baseSymbol = t.symbol.replace('USDT', '');
      if (blacklist.includes(baseSymbol)) return false;
      
      for (const suffix of invalidSuffixes) {
        if (t.symbol.endsWith(`${suffix}USDT`)) return false;
      }
      
      return true;
    });

    // Sort by quoteVolume descending and take top 300
    filtered.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
    return filtered.slice(0, 300);
  }

  private async evaluateCandidate(ticker: MexcTicker): Promise<boolean> {
    const quoteVolume = parseFloat(ticker.quoteVolume);
    if (quoteVolume < 200000) return false;

    // Fetch 5m klines
    const res = await fetch(`https://api.mexc.com/api/v3/klines?symbol=${ticker.symbol}&interval=5m&limit=100`);
    if (!res.ok) return false;
    
    const klines = await res.json();
    if (klines.length < 50) return false;

    // kline format: [openTime, open, high, low, close, volume, closeTime, quoteVolume]
    const closes = klines.map((k: any) => parseFloat(k[4]));
    const volumes = klines.map((k: any) => parseFloat(k[5]));
    const highs = klines.map((k: any) => parseFloat(k[2]));
    const lows = klines.map((k: any) => parseFloat(k[3]));
    
    const currentVolume = volumes[volumes.length - 1];
    const avgVolume20 = this.calculateSma(volumes, 20);
    const rsi14 = this.calculateRsi(closes, 14);
    const atr14 = this.calculateAtr(highs, lows, closes, 14);

    if (avgVolume20 === null || rsi14 === null || atr14 === null) return false;

    // Condition 1: Volume Surge
    if (currentVolume <= avgVolume20 * 1.8) return false;

    // Condition 2: RSI Extremes (Variation 4)
    let direction: 'LONG' | 'SHORT' | null = null;
    if (rsi14 < 25) {
      direction = 'LONG';
    } else if (rsi14 > 75) {
      direction = 'SHORT';
    }

    if (!direction) return false;

    // Attach decision and ATR to the alert callback if we succeed
    if (this.onAlertCallback) {
      const alertId = `alert_MEXC_${ticker.symbol}_${Math.floor(Date.now() / (5 * 60 * 1000))}`;
      const alert: NormalizedAlert = {
        alertId,
        symbol: ticker.symbol,
        timestamp: Date.now(),
        source: 'MEXC_SCANNER',
        rawText: `MEXC Scanner Alert: Variation 4 ${direction} detected for ${ticker.symbol}`,
        metadata: {
          rawSymbolExtracted: ticker.symbol.replace('USDT', ''),
          quoteVolume: ticker.quoteVolume,
          lastPrice: ticker.lastPrice,
          direction,
          atr14
        }
      };
      
      // Override default behavior, evaluateCandidate returns false but fires manually
      await this.onAlertCallback(alert);
    }

    return false; // Handled manually above
  }

  private calculateSma(data: number[], period: number): number | null {
    if (data.length < period) return null;
    let sum = 0;
    for (let i = data.length - period; i < data.length; i++) {
        sum += data[i];
    }
    return sum / period;
  }
  
  private calculateRsi(prices: number[], period: number = 14): number | null {
      if (prices.length <= period) return null;
      let gains = 0, losses = 0;
      
      for(let i = 1; i <= period; i++) {
          const change = prices[i] - prices[i-1];
          if (change > 0) gains += change;
          else losses -= change;
      }
      
      let avgGain = gains / period;
      let avgLoss = losses / period;
      
      for (let i = period + 1; i < prices.length; i++) {
          const change = prices[i] - prices[i-1];
          let gain = change > 0 ? change : 0;
          let loss = change < 0 ? -change : 0;
          
          avgGain = (avgGain * (period - 1) + gain) / period;
          avgLoss = (avgLoss * (period - 1) + loss) / period;
      }
      
      if (avgLoss === 0) return 100;
      const rs = avgGain / avgLoss;
      return 100 - (100 / (1 + rs));
  }

  private calculateAtr(highs: number[], lows: number[], closes: number[], period: number = 14): number | null {
    if (highs.length <= period) return null;
    
    let trSum = 0;
    const trueRanges: number[] = [];

    // First TR is just High - Low
    trueRanges.push(highs[0] - lows[0]);

    for (let i = 1; i < highs.length; i++) {
      const high = highs[i];
      const low = lows[i];
      const prevClose = closes[i - 1];
      
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trueRanges.push(tr);
    }

    // Initial ATR is simple average of first 'period' TRs
    for (let i = 1; i <= period; i++) {
      trSum += trueRanges[i];
    }
    let atr = trSum / period;

    // Smoothing for the rest
    for (let i = period + 1; i < trueRanges.length; i++) {
      atr = ((atr * (period - 1)) + trueRanges[i]) / period;
    }

    return atr;
  }
}
