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
    const excludedCoins = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'ADA', 'DOGE', 'AVAX', 'TRX', 'LTC', 'BCH', 'DOT'];
    
    let filtered = tickers.filter(t => {
      if (!t.symbol.endsWith('USDT')) return false;
      if (stablecoins.includes(t.symbol)) return false;

      const baseSymbol = t.symbol.replace('USDT', '');
      if (excludedCoins.includes(baseSymbol)) return false;
      
      for (const suffix of invalidSuffixes) {
        if (t.symbol.endsWith(`${suffix}USDT`)) return false;
      }
      
      return true;
    });

    // Sort by quoteVolume descending and take top 150
    filtered.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
    return filtered.slice(0, 150);
  }

  private async evaluateCandidate(ticker: MexcTicker): Promise<boolean> {
    const quoteVolume = parseFloat(ticker.quoteVolume);
    if (quoteVolume < 250000) {
      return false; // Hard gate: Minimum $250k 24h volume
    }

    const askPrice = parseFloat(ticker.askPrice);
    const bidPrice = parseFloat(ticker.bidPrice);
    if (bidPrice > 0) {
      const spread = (askPrice - bidPrice) / bidPrice;
      if (spread > 0.0080) {
         return false; // Hard gate: 80 bps max spread
      }
    } else {
       return false;
    }

    // Fetch 1h klines
    const res = await fetch(`https://api.mexc.com/api/v3/klines?symbol=${ticker.symbol}&interval=60m&limit=100`);
    if (!res.ok) {
       return false;
    }
    const klines = await res.json();
    if (klines.length < 100) {
       return false; // Hard gate: 100 1h lookback candles
    }

    // kline format: [openTime, open, high, low, close, volume, closeTime, quoteVolume]
    const closes = klines.map((k: any) => parseFloat(k[4]));
    const ema20 = this.calculateEma(closes, 20);
    const currentPrice = closes[closes.length - 1];

    if (ema20 === null || ema20 <= 0) return false;

    const extension = (currentPrice - ema20) / ema20;
    if (extension > 0.20) {
       return false; // Hard gate: Max EMA20 extension 20%
    }

    const score = this.scoreSymbol(klines, closes, ema20);
    return score >= 0.55;
  }

  private calculateEma(prices: number[], period: number): number | null {
    if (prices.length < period) return null;
    
    // Simple SMA for the first EMA value
    let sum = 0;
    for (let i = 0; i < period; i++) {
       sum += prices[i];
    }
    let ema = sum / period;
    
    const multiplier = 2 / (period + 1);
    
    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }
    
    return ema;
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

  private scoreSymbol(klines: any[], closes: number[], ema20: number): number {
    let score = 0;
    const currentPrice = closes[closes.length - 1];
    
    // 1. Trend Structure (Price > EMA20)
    if (currentPrice > ema20) {
        score += 0.25;
    }
    
    // 2. EMA20 > EMA50 check
    const ema50 = this.calculateEma(closes, 50);
    if (ema50 && ema20 > ema50) {
        score += 0.25;
    }
    
    // 3. Volume Surge
    const volumes = klines.map((k: any) => parseFloat(k[5]));
    const currentVolume = volumes[volumes.length - 1];
    const avgVolume20 = this.calculateSma(volumes, 20);
    if (avgVolume20 && currentVolume > avgVolume20 * 1.5) {
        score += 0.25;
    }
    
    // 4. RSI Momentum (50-70 ideal accumulation)
    const rsi = this.calculateRsi(closes, 14);
    if (rsi && rsi >= 50 && rsi <= 75) {
        score += 0.25;
    }
    
    return score;
  }
}
