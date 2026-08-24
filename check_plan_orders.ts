import { WeexRestClient } from './src/execution/adapters/weex/weex_client.js';
import { logger } from './src/utils/logger.js';

async function checkEndpoints() {
  const client = new WeexRestClient();
  const endpointsToTry = [
    '/capi/v3/plan/currentPlan?symbol=BTCUSDT',
    '/capi/v3/plan/orders?symbol=BTCUSDT',
    '/capi/v3/entrust/currentPlan?symbol=BTCUSDT',
    '/capi/v3/trigger/openOrders?symbol=BTCUSDT',
    '/capi/v3/condition/openOrders?symbol=BTCUSDT',
    '/capi/v3/account/planOrders?symbol=BTCUSDT',
    '/capi/v3/order/planOrders?symbol=BTCUSDT',
    '/capi/v3/plan/openOrders?symbol=BTCUSDT',
    '/capi/v3/order/openOrders?symbol=BTCUSDT',
    '/capi/v3/trade/openOrders?symbol=BTCUSDT',
    '/capi/v3/plan/current?symbol=BTCUSDT',
    '/capi/v3/plan/active?symbol=BTCUSDT',
    '/capi/v3/tpSl/openOrders?symbol=BTCUSDT',
    '/capi/v3/tpsl/currentPlan?symbol=BTCUSDT'
  ];

  for (const ep of endpointsToTry) {
    try {
      const res = await client.request('GET', ep);
      if (res.status === 200 && res.data && res.data.code === '0') {
        logger.info({ endpoint: ep, data: res.data }, "Found valid endpoint!");
      } else {
        logger.warn({ endpoint: ep, status: res.status, code: res.data?.code, msg: res.data?.msg }, "Endpoint failed or invalid.");
      }
    } catch (e: any) {
      logger.error({ endpoint: ep, error: e.message }, "Endpoint threw error.");
    }
  }
}

checkEndpoints();
