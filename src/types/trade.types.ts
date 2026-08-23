import { StrategyConfig } from './strategy.types.js';

export enum TradeState {
  ALERT_RECEIVED = 'ALERT_RECEIVED',
  VELOCITY_EVALUATING = 'VELOCITY_EVALUATING',
  ADMISSION_PENDING = 'ADMISSION_PENDING',
  ADMISSION_REJECTED = 'ADMISSION_REJECTED',
  ENTRY_SUBMITTED = 'ENTRY_SUBMITTED',
  POSITION_ACTIVE_UNPROTECTED = 'POSITION_ACTIVE_UNPROTECTED',
  POSITION_PROTECTED = 'POSITION_PROTECTED',
  SECONDARY_LIMIT_SUBMITTED = 'SECONDARY_LIMIT_SUBMITTED',
  EXPANDED_POSITION_RECALCULATING = 'EXPANDED_POSITION_RECALCULATING',
  EXPANDED_PROTECTED = 'EXPANDED_PROTECTED',
  CLOSING_SUBMITTED = 'CLOSING_SUBMITTED',
  CLOSED_VERIFIED = 'CLOSED_VERIFIED',
  RECONCILIATION_REQUIRED = 'RECONCILIATION_REQUIRED',
  TERMINAL_FAILED = 'TERMINAL_FAILED'
}

export interface TradeRecord {
  id: string;
  alertId: string;
  symbol: string;
  state: TradeState;
  gitCommitId: string;
  strategyConfigSnapshot: StrategyConfig;
  
  // Primary Entry Details
  primaryOrderId?: string;
  primaryClientOrderId?: string;
  primaryQuantity?: string;
  primaryEntryPrice?: number;
  primaryFilledAt?: number;
  
  // Secondary Entry Details
  secondaryOrderId?: string;
  secondaryClientOrderId?: string;
  secondaryQuantity?: string;
  secondaryLimitPrice?: number;
  secondaryFilledAt?: number;
  
  // Position Aggregate Details
  currentPositionSize: string;
  weightedAverageEntryPrice: number;
  
  // Native Protection Orders
  activeTpOrderId?: string;
  activeSlOrderId?: string;
  currentTpTriggerPrice?: string;
  currentSlTriggerPrice?: string;
  
  // Lifecycle Timestamps
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  
  // Error & Failure Auditing
  lastError?: string;
  reconciliationNotes?: string;
}

export interface StateTransitionEvent {
  tradeId: string;
  fromState: TradeState;
  toState: TradeState;
  timestamp: number;
  triggerReason: string;
  metadata?: Record<string, any>;
}
