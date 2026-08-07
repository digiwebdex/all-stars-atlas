-- Email system: own-domain SMTP support, password reset columns, delivery logs

ALTER TABLE users ADD COLUMN otp_code VARCHAR(255) NULL;
ALTER TABLE users ADD COLUMN otp_expires DATETIME NULL;
ALTER TABLE users ADD COLUMN reset_token VARCHAR(100) NULL;
ALTER TABLE users ADD COLUMN reset_expires DATETIME NULL;

CREATE TABLE IF NOT EXISTS email_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  recipient VARCHAR(255) NOT NULL,
  subject VARCHAR(255) NULL,
  status VARCHAR(20) NOT NULL,
  provider VARCHAR(20) NOT NULL,
  error_message VARCHAR(500) NULL,
  message_id VARCHAR(255) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email_logs_created (created_at),
  INDEX idx_email_logs_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO system_settings (setting_key, setting_value, updated_at)
VALUES ('api_email_smtp', '{"enabled":"true","host":"mail.seventrip.net","port":"587","secure":"false","user":"noreply@seventrip.net","password":"","from_email":"Seven Trip <noreply@seventrip.net>"}', NOW())
ON DUPLICATE KEY UPDATE updated_at = NOW();
