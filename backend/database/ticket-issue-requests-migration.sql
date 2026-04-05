-- Migration: Create ticket_issue_requests table
-- Run: mysql -u root seventrip < backend/database/ticket-issue-requests-migration.sql

CREATE TABLE IF NOT EXISTS ticket_issue_requests (
  id CHAR(36) PRIMARY KEY,
  booking_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  status ENUM('pending', 'processing', 'issued', 'rejected') DEFAULT 'pending',
  notes TEXT NULL,
  admin_notes TEXT NULL,
  processed_by CHAR(36) NULL,
  processed_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_tir_status (status),
  INDEX idx_tir_booking (booking_id),
  INDEX idx_tir_user (user_id)
);
