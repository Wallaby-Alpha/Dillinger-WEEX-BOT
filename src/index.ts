import http from 'http';
import { ENV } from './config/env.js';
import { SYSTEM_CONFIG } from './config/system.config.js';
import { SingleInstanceManager } from './utils/single_instance.js';
import { getGitCommitId } from './utils/git_info.js';
import { logger } from './utils/logger.js';
import { MexcScannerService } from './ingestion/mexc_scanner.js';
import { StrategyEngine } from './strategy/strategy_engine.js';
import { WeexExecutionAdapter } from './execution/adapters/weex/weex_adapter.js';
import { InMemoryTradeRepository } from './database/trade_repository.js';
import { PostgresTradeRepository } from './database/postgres_trade_repository.js';
import { TradeStateMachine } from './execution/trade_state_machine.js';
import { ReconciliationEngine } from './execution/reconciler.js';
import { TradeState } from './types/trade.types.js';

export async function bootstrap() {
  // 1. Single Instance Lock (prevents duplicate Droplet processes)
  const singleInstance = new SingleInstanceManager();
  singleInstance.acquireLock();

  const commitId = getGitCommitId();
  logger.info({ commitId, env: ENV.NODE_ENV }, "Starting WEEX Momentum Trading Bot...");

  // 2. Initialize Ingestion (Always needed)
  const scannerService = new MexcScannerService(SYSTEM_CONFIG.reconciliationIntervalMs ? 300 : 300);

  if (ENV.DRY_RUN) {
    logger.info("=========================================");
    logger.info("   DRY_RUN ENABLED. EXECUTING INGESTION ONLY. ");
    logger.info("   EXECUTION AND STRATEGY ENGINES ARE UNREACHABLE.");
    logger.info("=========================================");

    scannerService.onAlert(async (alert) => {
      logger.info({ alertId: alert.alertId, symbol: alert.symbol, normalizedOutput: alert }, "DRY_RUN: Normalized alert produced.");
    });

    scannerService.start();

    const shutdown = async (signal: string) => {
      logger.info({ signal }, "Received shutdown signal. Performing graceful cleanup...");
      scannerService.stop();
      singleInstance.releaseLock();
      logger.info("Graceful shutdown complete.");
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    return; // Exit bootstrap early, WEEX adapter is structurally unreachable
  }

  // === LIVE EXECUTION PIPELINE (Only instantiated if DRY_RUN is false) ===
  if (!ENV.DATABASE_URL) {
    logger.fatal("DATABASE_URL is not configured. Failing closed to prevent data loss in live mode.");
    process.exit(1);
  }

  const adapter = new WeexExecutionAdapter();
  const repository = new PostgresTradeRepository();
  const strategyEngine = new StrategyEngine();
  const stateMachine = new TradeStateMachine(adapter, repository, strategyEngine.getCooldownTracker());
  const reconciler = new ReconciliationEngine(stateMachine, adapter, repository);

  // 3. Startup Reconciliation: Verify exchange state before admitting new signals
  logger.info("Executing startup exchange reconciliation...");
  try {
    const margin = await adapter.getAvailableMargin();
    logger.info({ availableMarginUsdt: margin }, "WEEX exchange connectivity verified.");

    const activeExchangePositions = await adapter.getActivePositions();
    const activeDbTrades = await repository.getActiveTrades();
    const activeDbSymbols = new Set(activeDbTrades.map(t => t.symbol));

    for (const pos of activeExchangePositions) {
      if (!activeDbSymbols.has(pos.symbol)) {
        logger.warn({ symbol: pos.symbol, size: pos.size }, "Found orphaned exchange position without active DB trade.");
        
        let isProtected = false;
        let activeTpId: string | undefined = pos.activeTpOrderId;
        let activeSlId: string | undefined = pos.activeSlOrderId;
        
        // 1. Genuine Discovery: Fetch open algo orders for this symbol/side
        try {
          const algos = await adapter.listActiveProtectionOrders(pos.symbol, pos.side);
          logger.info({ rawAlgoOrders: algos }, "RAW DISCOVERY PAYLOAD");
          
          if (algos.length > 0) {
             // 2. Verification: Explicitly verify the first discovered algo ID
             const candidateId = algos[0].orderId;
             const summary = await adapter.verifyProtectionOrder(pos.symbol, candidateId);
             
             if (summary && (summary.status === 'NEW' || summary.status === 'UNTRIGGERED')) {
                isProtected = true;
                activeTpId = candidateId;
                if (algos.length > 1) activeSlId = algos[1].orderId;
             } else {
                logger.warn({ symbol: pos.symbol, candidateId, status: summary?.status }, "Discovery found algoId but verifyProtectionOrder rejected it. Treating as UNVERIFIED/UNPROTECTED.");
             }
          }
        } catch (err: any) {
          logger.warn({ err: err.message, symbol: pos.symbol }, "Failed to discover active protection orders.");
        }
        
        if (isProtected) {
          logger.info({ symbol: pos.symbol }, "PROTECTED ORPHAN: Reconstructing trade record to resume tracking.");
          
          const reconstructedTrade: any = {
            id: `trade_${pos.symbol}_recovered_${Date.now()}`,
            symbol: pos.symbol,
            state: TradeState.POSITION_PROTECTED,
            gitCommitId: commitId,
            strategyConfigSnapshot: strategyEngine.getConfig(),
            primaryQuantity: pos.size,
            primaryEntryPrice: pos.entryPrice,
            currentPositionSize: pos.size,
            weightedAverageEntryPrice: pos.entryPrice,
            activeTpOrderId: activeTpId,
            activeSlOrderId: activeSlId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            reconciliationNotes: "Recovered from protected orphan on startup"
          };
          
          try {
            await repository.saveTrade(reconstructedTrade);
            logger.info({ tradeId: reconstructedTrade.id }, "Recovered trade persisted. Resuming normal lifecycle monitoring.");
          } catch (err: any) {
            logger.fatal({ err: err.message, symbol: pos.symbol }, "CRITICAL: Failed to persist reconstructed trade. Cannot safely track protected position. ROUTING TO EMERGENCY CLOSE.");
            try {
               await adapter.closePositionMarket(pos.symbol, pos.side, pos.size);
               logger.info({ symbol: pos.symbol }, "Emergency close order submitted for untrackable protected position.");
            } catch (closeErr: any) {
               logger.fatal({ err: closeErr.message, symbol: pos.symbol }, "CRITICAL: Emergency close for untrackable position failed. Halting bot with unresolved exposure!");
               process.exit(1);
            }
          }
        } else {
          logger.error({ symbol: pos.symbol }, "UNPROTECTED ORPHAN: NO UNPROTECTED POSITION INVARIANT VIOLATED. ROUTING TO EMERGENCY CLOSE.");
          
          try {
             await adapter.closePositionMarket(pos.symbol, pos.side, pos.size);
             logger.info({ symbol: pos.symbol }, "Emergency close order submitted for unprotected orphan.");
          } catch (err: any) {
             logger.fatal({ err: err.message, symbol: pos.symbol }, "CRITICAL: Emergency close for unprotected orphan failed. Halting bot with unresolved exposure!");
             process.exit(1);
          }
        }
      }
    }

  } catch (err: any) {
    logger.error({ err: err.message }, "Failed initial exchange connectivity check on startup.");
  }

  // 4. Wire Ingestion -> Strategy -> Execution Pipeline
  scannerService.onAlert(async (alert) => {
    try {
      logger.info({ alertId: alert.alertId, symbol: alert.symbol }, "Processing incoming alert through pipeline.");

      const meta = await adapter.getSymbolMetadata(alert.symbol);
      const markPrice = meta ? await adapter.getMarkPrice(alert.symbol) : 0;
      const availableMargin = await adapter.getAvailableMargin();
      const activeTrades = await repository.getActiveTrades();

      // Prevent concurrent trades on the same symbol by strictly checking the Exchange
      const existingPosition = await adapter.getActivePosition(alert.symbol);
      if (existingPosition && parseFloat(existingPosition.size) > 0) {
        logger.info({ symbol: alert.symbol, size: existingPosition.size }, "Skipping alert: A position is already actively open on the exchange for this symbol.");
        return;
      }

      const decision = strategyEngine.evaluateAlert(
        alert,
        markPrice,
        availableMargin,
        activeTrades.length,
        meta
      );

      if (!decision.admitted) {
        logger.warn({ symbol: alert.symbol, reason: decision.rejectionReason }, "Trade intent rejected by strategy engine.");
        return;
      }

      // 4.5 First-Time Symbol Audit Check (Fire-and-forget, non-blocking)
      repository.hasSymbolBeenTraded(alert.symbol).then(hasBeenTraded => {
        if (!hasBeenTraded) {
          logger.warn({ symbol: alert.symbol, newSymbol: true }, "FIRST-TIME SYMBOL: Admitting trade for a symbol never seen before.");
        }
      }).catch(err => {
        logger.error({ err: err.message, symbol: alert.symbol }, "Failed to verify first-time symbol status.");
      });

      // Execute trade via state machine
      await stateMachine.startTrade(decision, alert);
    } catch (err: any) {
      logger.error({ err: err.message, alertId: alert.alertId }, "Error processing alert pipeline.");
    }
  });

  // 5. Start Background Loops
  reconciler.start(SYSTEM_CONFIG.reconciliationIntervalMs);
  scannerService.start();

  // 6. DigitalOcean Uptime Healthcheck HTTP Server
  const server = http.createServer(async (req, res) => {
    if (req.url === '/health' || req.url === '/') {
      const activeTrades = await repository.getActiveTrades();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'UP',
        appName: SYSTEM_CONFIG.appName,
        gitCommitId: commitId,
        activeTradesCount: activeTrades.length,
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: Date.now()
      }));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  server.listen(SYSTEM_CONFIG.healthCheckPort, () => {
    logger.info({ port: SYSTEM_CONFIG.healthCheckPort }, "Health check monitoring server listening.");
  });

  // 7. Graceful Shutdown Handler
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Received shutdown signal. Performing graceful cleanup...");
    scannerService.stop();
    reconciler.stop();

    server.close(() => {
      logger.info("Health check server closed.");
    });

    singleInstance.releaseLock();
    logger.info("Graceful shutdown complete.");
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (!process.env.VITEST) {
  bootstrap().catch((err) => {
    logger.fatal({ err: err.message }, "Fatal error during bot bootstrap.");
    process.exit(1);
  });
}
