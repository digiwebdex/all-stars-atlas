-- ============================================================
-- Admin Enterprise Upgrade Migration
-- Covers: partial-payment rules, per-client commission, agent ID,
-- deposit-approval permission, route restrictions, B2C partial toggle,
-- per-airline commission, partial override.
-- Run: mysql seventrip < backend/database/admin-enterprise-migration.sql
-- ============================================================

-- 1) Per-client commission overrides
CREATE TABLE IF NOT EXISTS user_commission_overrides (
  user_id CHAR(36) PRIMARY KEY,
  discount_pct DECIMAL(6,3) NULL,
  ait_pct DECIMAL(6,3) NULL,
  markup_pct DECIMAL(6,3) NULL,
  notes TEXT NULL,
  updated_by CHAR(36) NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 2) Airline route restrictions (Road-to-Road)
CREATE TABLE IF NOT EXISTS airline_route_restrictions (
  id CHAR(36) PRIMARY KEY,
  airline_code VARCHAR(8) NOT NULL,
  blocked_origin_country VARCHAR(8) NULL,
  blocked_dest_country VARCHAR(8) NULL,
  allowed_origin_country VARCHAR(8) NULL,
  allowed_dest_country VARCHAR(8) NULL,
  notes TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_arr_airline (airline_code)
);

-- 3) Deposit approval permission flag on users
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'can_approve_deposits');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE users ADD COLUMN can_approve_deposits TINYINT(1) DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) Partial-payment override & split on bookings
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'partial_override');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE bookings ADD COLUMN partial_override TINYINT(1) DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'partial_split_pct');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE bookings ADD COLUMN partial_split_pct DECIMAL(5,2) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5) Default system_settings rows for partial-payment rules + B2C toggle
INSERT INTO system_settings (setting_key, setting_value, updated_at)
VALUES
  ('b2c_partial_enabled', 'true', NOW()),
  ('partial_min_hours', '96', NOW()),
  ('partial_upfront_pct', '30', NOW())
ON DUPLICATE KEY UPDATE setting_value = setting_value;
