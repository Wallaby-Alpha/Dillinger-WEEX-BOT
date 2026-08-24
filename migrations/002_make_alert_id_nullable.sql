-- Migration 002: Make alert_id nullable for recovered trades

ALTER TABLE trades ALTER COLUMN alert_id DROP NOT NULL;
