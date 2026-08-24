/**
 * Abstract Exchange Execution Adapter Contract.
 * The Strategy Layer interacts only with this interface.
 */

export interface SymbolMetadata {
  symbol: string;
  pricePrecision: number;
  quantityPrecision: number;
  contractVal: number;
  minOrderSize: number;
  maxOrderSize: number;
  maxPositionSize: number;
  minLeverage: number;
  maxLeverage: number;
}

export interface EntryOrderRequest {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT';
  positionSide: 'LONG' | 'SHORT';
  quantity: string;
  price?: string;
  clientOrderId: string;
  presetTakeProfitPrice?: string;
  presetStopLossPrice?: string;
}

export interface OrderResult {
  orderId: string;
  clientOrderId?: string;
  success: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface WholePositionProtectionRequest {
  symbol: string;
  positionSide: 'LONG' | 'SHORT';
  planType: 'TAKE_PROFIT' | 'STOP_LOSS';
  triggerPrice: string;
  clientAlgoId: string;
}

export interface UpdateProtectionRequest {
  symbol: string;
  orderId: string;
  triggerPrice: string;
}

export interface ProtectionResult {
  success: boolean;
  orderId?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface PositionState {
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: string;
  openValue: string;
  entryPrice: number;
  isolatedMargin: string;
  liquidatePrice?: string;
  unrealizePnl?: string;
  activeTpOrderId?: string;
  activeSlOrderId?: string;
}

export interface OpenOrderSummary {
  orderId: string;
  clientOrderId?: string;
  type: string;
  side: string;
  positionSide: string;
  price: string;
  origQty: string;
  executedQty: string;
  status: string;
  stopPrice?: string;
  reduceOnly?: boolean;
}

export interface ExchangeStateSnapshot {
  timestamp: number;
  symbol: string;
  position: PositionState | null;
  openOrders: OpenOrderSummary[];
  activeTpOrder: OpenOrderSummary | null;
  activeSlOrder: OpenOrderSummary | null;
  availableBalanceUsdt: number;
}

export interface IExecutionAdapter {
  /** Exchange identification */
  readonly exchangeName: string;

  /** Market data */
  getSymbolMetadata(symbol: string): Promise<SymbolMetadata | null>;
  getMarkPrice(symbol: string): Promise<number>;

  /** Account status */
  getAvailableMargin(): Promise<number>;
  setLeverage(symbol: string, leverage: number): Promise<void>;
  getActivePositions(): Promise<PositionState[]>;
  getActivePosition(symbol: string): Promise<PositionState | null>;

  /** Order operations */
  submitEntryOrder(req: EntryOrderRequest): Promise<OrderResult>;
  cancelOrder(symbol: string, orderId?: string, clientOrderId?: string): Promise<void>;

  /** Whole-Position Native Protection */
  establishWholePositionProtection(req: WholePositionProtectionRequest): Promise<ProtectionResult>;
  updateWholePositionProtection(req: UpdateProtectionRequest): Promise<ProtectionResult>;
  verifyProtectionOrder(symbol: string, orderId: string): Promise<OpenOrderSummary | null>;

  /**
   * Discovers active conditional/algo orders matching symbol and side.
   */
  listActiveProtectionOrders(symbol: string, positionSide: string): Promise<OpenOrderSummary[]>;

  /** Position Close & Verification */
  closePositionMarket(symbol: string, positionSide: 'LONG' | 'SHORT', quantity: string): Promise<OrderResult>;
  fetchExchangeState(symbol: string): Promise<ExchangeStateSnapshot>;
}
