import http from 'http';
import { ENV } from './config/env.js';
import { SYSTEM_CONFIG } from './config/system.config.js';
import { SingleInstanceManager } from './utils/single_instance.js';
import { getGitCommitId } from './utils/git_info.js';
import { logger } from './utils/logger.js';
import { TelegramIngestionService } from './ingestion/telegram_client.js';
import { StrategyEngine } from './strategy/strategy_engine.js';
import { WeexExecutionAdapter } from './execution/adapters/weex/weex_adapter.js';
import { InMemoryTradeRepository } from './database/trade_repository.js';
import { TradeStateMachine } from './execution/trade_state_machine.js';
import { ReconciliationEngine } from './execution/reconciler.js';

export async function bootstrap() {
  // 1. Single Instance Lock (prevents duplicate Droplet processes)
  const singleInstance = new SingleInstanceManager();
  singleInstance.acquireLock();

  const commitId = getGitCommitId();
  logger.info({ commitId, env: ENV.NODE_ENV }, "Starting WEEX Momentum Trading Bot...");

  // 2. Initialize Layer Components
  const adapter = new WeexExecutionAdapter();
  const repository = new InMemoryTradeRepository();
  const strategyEngine = new StrategyEngine();
  const stateMachine = new TradeStateMachine(adapter, repository, strategyEngine.getCooldownTracker());
  const reconciler = new ReconciliationEngine(stateMachine, adapter, repository);
  const telegramService = new TelegramIngestionService();

  // 3. Startup Reconciliation: Verify exchange state before admitting new signals
  logger.info("Executing startup exchange reconciliation...");
  try {
    const margin = await adapter.getAvailableMargin();
    logger.info({ availableMarginUsdt: margin }, "WEEX exchange connectivity verified.");
  } catch (err: any) {
    logger.error({ err: err.message }, "Failed initial exchange connectivity check on startup.");
  }

  // 4. Wire Ingestion -> Strategy -> Execution Pipeline
  telegramService.onAlert(async (alert) => {
    try {
      logger.info({ alertId: alert.alertId, symbol: alert.symbol }, "Processing incoming alert through pipeline.");

      const meta = await adapter.getSymbolMetadata(alert.symbol);
      const markPrice = await adapter.getMarkPrice(alert.symbol);
      const availableMargin = await adapter.getAvailableMargin();
      const activeTrades = await repository.getActiveTrades();

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

      // Execute trade via state machine
      await stateMachine.startTrade(decision, alert);
    } catch (err: any) {
      logger.error({ err: err.message, alertId: alert.alertId }, "Error processing alert pipeline.");
    }
  });

  // 5. Start Background Loops
  reconciler.start(SYSTEM_CONFIG.reconciliationIntervalMs);
  telegramService.start();

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
    telegramService.stop();
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

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  bootstrap().catch((err) => {
    logger.fatal({ err: err.message }, "Fatal error during bot bootstrap.");
    process.exit(1);
  });
}
