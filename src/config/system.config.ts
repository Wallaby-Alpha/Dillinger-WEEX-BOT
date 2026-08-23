/**
 * Server and System Operation Settings for DigitalOcean Droplet Deployment.
 */
export const SYSTEM_CONFIG = Object.freeze({
  appName: "weex-momentum-bot",
  reconciliationIntervalMs: 5000,    // Poll exchange authoritative state every 5s
  wsHeartbeatIntervalMs: 30000,      // Ping WebSocket every 30s
  wsReconnectDelayMs: 3000,          // Delay before reconnecting dropped WS
  healthCheckPort: 3000,             // Health check HTTP port
  lockFilePath: ".bot_instance.lock",// Single instance lockfile path
  gracefulShutdownTimeoutMs: 10000   // 10s grace period for in-flight requests on SIGTERM
});
