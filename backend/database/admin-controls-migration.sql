-- ============================================================
-- Admin Controls Migration
-- Adds: OTP login table, per-user partial permission,
--       secondary admin role flags, admin theme + b2b partial toggle.
-- Run: mysql --force seventrip < backend/database/admin-controls-migration.sql
-- ============================================================

-- 1) OTP codes for passwordless login (SMS + Email)
CREATE TABLE IF NOT EXISTS otp_login_codes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  identifier VARCHAR(255) NOT NULL,           -- email or E.164/BD phone
  channel ENUM('email','sms') NOT NULL,
  code VARCHAR(10) NOT NULL,
  attempts INT DEFAULT 0,
  consumed TINYINT(1) DEFAULT 0,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_otp_identifier (identifier),
  INDEX idx_otp_expires (expires_at)
);

-- 2) Per-user partial payment permission (override of global toggle)
CREATE TABLE IF NOT EXISTS user_partial_permission (
  user_id CHAR(36) PRIMARY KEY,
  enabled TINYINT(1) DEFAULT 1,
  updated_by CHAR(36) NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3) Secondary-admin permission flags on users
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='can_manage_bookings');
SET @s := IF(@c = 0, 'ALTER TABLE users ADD COLUMN can_manage_bookings TINYINT(1) DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='can_toggle_partial');
SET @s := IF(@c = 0, 'ALTER TABLE users ADD COLUMN can_toggle_partial TINYINT(1) DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) Defaults for admin theme + B2B partial toggle
INSERT INTO system_settings (setting_key, setting_value, updated_at) VALUES
  ('b2b_partial_enabled',    'true',    NOW()),
  ('admin_theme_primary',    '#2563eb', NOW()),
  ('admin_theme_accent',     '#0ea5e9', NOW()),
  ('admin_theme_sidebar_bg', '#0f172a', NOW())
ON DUPLICATE KEY UPDATE setting_value = setting_value;
