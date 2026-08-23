-- =============================================================================
-- Migration 001: Initial Production Schema for WEEX Momentum Bot
-- =============================================================================

-- 1. Ingestion Alerts Table
CREATE TABLE IF NOT EXISTS alerts (
    id VARCHAR(64) PRIMARY KEY,
    symbol VARCHAR(32) NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    alert_timestamp BIGINT NOT NULL,
    source VARCHAR(64) NOT NULL,
    raw_text TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    rejection_reason TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_symbol ON alerts(symbol);
CREATE INDEX IF NOT EXISTS idx_alerts_received_at ON alerts(received_at);

-- 2. Master Trades Lifecycle Table
CREATE TABLE IF NOT EXISTS trades (
    id VARCHAR(64) PRIMARY KEY,
    alert_id VARCHAR(64) REFERENCES alerts(id),
    symbol VARCHAR(32) NOT NULL,
    state VARCHAR(48) NOT NULL,
    git_commit_id VARCHAR(64) NOT NULL,
    strategy_config_snapshot JSONB NOT NULL,
    
    -- Primary Entry
    primary_order_id VARCHAR(64),
    primary_client_order_id VARCHAR(64),
    primary_quantity NUMERIC(18, 8),
    primary_entry_price NUMERIC(18, 8),
    primary_filled_at BIGINT,

    -- Secondary Entry
    secondary_order_id VARCHAR(64),
    secondary_client_order_id VARCHAR(64),
    secondary_quantity NUMERIC(18, 8),
    secondary_limit_price NUMERIC(18, 8),
    secondary_filled_at BIGINT,

    -- Position Aggregate State
    current_position_size NUMERIC(18, 8) NOT NULL DEFAULT 0,
    weighted_average_entry_price NUMERIC(18, 8) NOT NULL DEFAULT 0,

    -- Native Exchange Protection
    active_tp_order_id VARCHAR(64),
    active_sl_order_id VARCHAR(64),
    current_tp_trigger_price NUMERIC(18, 8),
    current_sl_trigger_price NUMERIC(18, 8),

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,

    -- Auditing & Error Tracking
    last_error TEXT,
    reconciliation_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_state ON trades(state);
CREATE INDEX IF NOT EXISTS idx_trades_git_commit ON trades(git_commit_id);

-- 3. Audit State Transitions Log
CREATE TABLE IF NOT EXISTS state_transitions (
    id BIGSERIAL PRIMARY KEY,
    trade_id VARCHAR(64) NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    from_state VARCHAR(48) NOT NULL,
    to_state VARCHAR(48) NOT NULL,
    timestamp BIGINT NOT NULL,
    trigger_reason TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transitions_trade_id ON state_transitions(trade_id);

-- 4. Persistent Cooldown Registry
CREATE TABLE IF NOT EXISTS symbol_cooldowns (
    symbol VARCHAR(32) PRIMARY KEY,
    active_until TIMESTAMPTZ NOT NULL,
    reason TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
