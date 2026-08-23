import crypto from 'crypto';
import { ENV } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';

export interface WeexApiResponse<T = any> {
  status: number;
  data: T;
}

export class WeexRestClient {
  private apiKey: string;
  private apiSecret: string;
  private passphrase: string;
  private baseUrl: string;

  constructor(
    apiKey: string = ENV.WEEX_API_KEY,
    apiSecret: string = ENV.WEEX_API_SECRET,
    passphrase: string = ENV.WEEX_PASSPHRASE,
    baseUrl: string = ENV.WEEX_BASE_URL
  ) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.passphrase = passphrase;
    this.baseUrl = baseUrl;
  }

  private generateSignature(timestamp: string, method: string, path: string, bodyStr: string): string {
    const message = timestamp + method + path + (bodyStr || '');
    return crypto.createHmac('sha256', this.apiSecret).update(message).digest('base64');
  }

  async request<T = any>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: any,
    isPublic: boolean = false
  ): Promise<WeexApiResponse<T>> {
    const timestamp = Date.now().toString();
    const bodyStr = (method !== 'GET' && method !== 'DELETE' && body) ? JSON.stringify(body) : '';
    const url = this.baseUrl + path;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'WeexMomentumBot/1.0'
    };

    if (!isPublic) {
      const signature = this.generateSignature(timestamp, method, path, bodyStr);
      headers['ACCESS-KEY'] = this.apiKey;
      headers['ACCESS-SIGN'] = signature;
      headers['ACCESS-TIMESTAMP'] = timestamp;
      headers['ACCESS-PASSPHRASE'] = this.passphrase;
    }

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: bodyStr || undefined
      });

      const json = await res.json().catch(() => null);

      if (res.status >= 400) {
        logger.warn({ status: res.status, method, path, response: json }, "WEEX API request returned non-2xx status.");
      }

      return {
        status: res.status,
        data: json as T
      };
    } catch (err: any) {
      logger.error({ err: err.message, method, path }, "Network exception during WEEX API request.");
      throw err;
    }
  }
}
