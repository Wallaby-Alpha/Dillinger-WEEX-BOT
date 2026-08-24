import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WeexExecutionAdapter } from '../../src/execution/adapters/weex/weex_adapter.js';
import { WeexRestClient } from '../../src/execution/adapters/weex/weex_client.js';

describe('WeexExecutionAdapter.verifyProtectionOrder', () => {
  let adapter: WeexExecutionAdapter;
  let mockRequest: any;

  beforeEach(() => {
    mockRequest = vi.fn();
    const mockClient = { request: mockRequest } as unknown as WeexRestClient;
    adapter = new WeexExecutionAdapter(mockClient);
  });

  it('should return valid order summary if status is NEW', async () => {
    mockRequest.mockResolvedValue({
      status: 200,
      data: {
        orderId: '123456',
        clientOrderId: 'b-789',
        type: 'MARKET',
        side: 'SELL',
        positionSide: 'LONG',
        price: '0',
        origQty: '0',
        executedQty: '0',
        status: 'NEW',
        reduceOnly: true
      }
    });

    const res = await adapter.verifyProtectionOrder('BTCUSDT', '123456');
    expect(res).not.toBeNull();
    expect(res?.status).toBe('NEW');
    expect(res?.orderId).toBe('123456');
  });

  it('should return valid order summary if status is UNTRIGGERED', async () => {
    mockRequest.mockResolvedValue({
      status: 200,
      data: {
        orderId: '123456',
        status: 'UNTRIGGERED'
      }
    });

    const res = await adapter.verifyProtectionOrder('BTCUSDT', '123456');
    expect(res).not.toBeNull();
    expect(res?.status).toBe('UNTRIGGERED');
  });

  it('should return null if status is TRIGGERED', async () => {
    mockRequest.mockResolvedValue({
      status: 200,
      data: {
        orderId: '123456',
        status: 'TRIGGERED'
      }
    });

    const res = await adapter.verifyProtectionOrder('BTCUSDT', '123456');
    expect(res).toBeNull();
  });

  it('should return null if status is FILLED', async () => {
    mockRequest.mockResolvedValue({
      status: 200,
      data: {
        orderId: '123456',
        status: 'FILLED'
      }
    });

    const res = await adapter.verifyProtectionOrder('BTCUSDT', '123456');
    expect(res).toBeNull();
  });

  it('should return null if status is CANCELLED', async () => {
    mockRequest.mockResolvedValue({
      status: 200,
      data: {
        orderId: '123456',
        status: 'CANCELLED'
      }
    });

    const res = await adapter.verifyProtectionOrder('BTCUSDT', '123456');
    expect(res).toBeNull();
  });

  it('should return null on 404', async () => {
    mockRequest.mockRejectedValue(new Error('404 Not Found'));

    const res = await adapter.verifyProtectionOrder('BTCUSDT', '123456');
    expect(res).toBeNull();
  });
});
