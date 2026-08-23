import { describe, it, expect } from 'vitest';
import { MockExecutionAdapter } from '../../src/execution/adapters/mock/mock_adapter.js';

describe('Phase 4: Execution Adapter Contract Tests', () => {
  it('should submit market entry and establish open position', async () => {
    const adapter = new MockExecutionAdapter();
    
    const entryRes = await adapter.submitEntryOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      positionSide: 'LONG',
      quantity: '0.0004',
      clientOrderId: 'b-test-entry-1'
    });

    expect(entryRes.success).toBe(true);
    expect(entryRes.orderId).toBeDefined();

    const pos = await adapter.getActivePosition('BTCUSDT');
    expect(pos).not.toBeNull();
    expect(pos?.size).toBe('0.0004');
    expect(pos?.entryPrice).toBe(77000.0);
  });

  it('should establish whole-position native TP/SL protection', async () => {
    const adapter = new MockExecutionAdapter();
    
    await adapter.submitEntryOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      positionSide: 'LONG',
      quantity: '0.0004',
      clientOrderId: 'b-test-entry-2'
    });

    const tpRes = await adapter.establishWholePositionProtection({
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      planType: 'TAKE_PROFIT',
      triggerPrice: '78925.0',
      clientAlgoId: 'b-test-tp-2'
    });

    const slRes = await adapter.establishWholePositionProtection({
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      planType: 'STOP_LOSS',
      triggerPrice: '75845.0',
      clientAlgoId: 'b-test-sl-2'
    });

    expect(tpRes.success).toBe(true);
    expect(slRes.success).toBe(true);

    const snapshot = await adapter.fetchExchangeState('BTCUSDT');
    expect(snapshot.activeTpOrder?.stopPrice).toBe('78925.0');
    expect(snapshot.activeTpOrder?.origQty).toBe('0.0000'); // Whole position
    expect(snapshot.activeSlOrder?.stopPrice).toBe('75845.0');
    expect(snapshot.activeSlOrder?.origQty).toBe('0.0000'); // Whole position
  });

  it('should modify whole-position protection in-place upon expansion', async () => {
    const adapter = new MockExecutionAdapter();
    
    await adapter.submitEntryOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      positionSide: 'LONG',
      quantity: '0.0004',
      clientOrderId: 'b-test-entry-3'
    });

    const tpRes = await adapter.establishWholePositionProtection({
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      planType: 'TAKE_PROFIT',
      triggerPrice: '78925.0',
      clientAlgoId: 'b-test-tp-3'
    });

    // Secondary fill (expands position to 0.0008 BTC)
    await adapter.submitEntryOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      positionSide: 'LONG',
      quantity: '0.0004',
      clientOrderId: 'b-test-entry-3-sec'
    });

    const pos = await adapter.getActivePosition('BTCUSDT');
    expect(pos?.size).toBe('0.0008');

    // In-place modification to new combined TP level
    const modRes = await adapter.updateWholePositionProtection({
      symbol: 'BTCUSDT',
      orderId: tpRes.orderId!,
      triggerPrice: '78950.0'
    });

    expect(modRes.success).toBe(true);
    const snapshot = await adapter.fetchExchangeState('BTCUSDT');
    expect(snapshot.activeTpOrder?.stopPrice).toBe('78950.0');
  });
});
