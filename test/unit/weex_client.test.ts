import { describe, it, expect, vi } from 'vitest';
import { WeexRestClient } from '../../src/execution/adapters/weex/weex_client.js';

describe('WeexRestClient', () => {
  it('should parse 64-bit integer IDs as strings to prevent IEEE-754 precision loss regardless of field name', async () => {
    const client = new WeexRestClient('test', 'test', 'test', 'http://localhost');
    
    // Mock the global fetch
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => `{
        "planId": 123456789012345678,
        "orderId": 987654321098765432,
        "algoId": 112233445566778899,
        "otherId": -12345678901234567,
        "status": "NEW",
        "arr": [123456789012345678, "string"]
      }`
    });
    
    global.fetch = mockFetch;

    const result = await client.request('GET', '/test');
    
    expect(result.data.planId).toBe("123456789012345678");
    expect(result.data.orderId).toBe("987654321098765432");
    expect(result.data.algoId).toBe("112233445566778899");
    expect(result.data.otherId).toBe("-12345678901234567");
    expect(result.data.status).toBe("NEW");
    expect(result.data.arr[0]).toBe("123456789012345678");
  });

  it('should safely stringify unquoted 64-bit IDs without corrupting large numbers inside quoted strings', async () => {
    const client = new WeexRestClient('test', 'test', 'test', 'http://localhost');
    
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => `{
        "orderId": 987654321098765432,
        "algoId": 112233445566778899,
        "clientOrderId": "b-trade-1787512470357",
        "nested": {
          "stringWithDigits": "123456789012345678",
          "unquotedNumber": -12345678901234567
        }
      }`
    });
    
    global.fetch = mockFetch;

    const result = await client.request('GET', '/test');
    
    // The unquoted numbers should be safely converted to exact strings
    expect(result.data.orderId).toBe("987654321098765432");
    expect(result.data.algoId).toBe("112233445566778899");
    expect(result.data.nested.unquotedNumber).toBe("-12345678901234567");
    
    // The quoted strings MUST remain totally untouched
    expect(result.data.clientOrderId).toBe("b-trade-1787512470357");
    expect(result.data.nested.stringWithDigits).toBe("123456789012345678");
  });
});
