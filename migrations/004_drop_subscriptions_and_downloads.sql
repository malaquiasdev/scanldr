-- Phase 4 decommission: subscriptions and downloads tables are no longer used.
-- The only persisted state is the traces table (003_create_traces.sql).
-- DROP IF EXISTS keeps this idempotent for existing installs where 001/002 ran.
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS downloads;
