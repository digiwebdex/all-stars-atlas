-- Allow wallet deposit / credit / transfer transaction types and mobile methods
-- Run: mysql -u root seventrip < backend/database/wallet-deposit-migration.sql

ALTER TABLE transactions
  MODIFY COLUMN type ENUM('payment','refund','recharge','bill_payment','esim_purchase','deposit','credit','debit','transfer_in','transfer_out','adjustment') NOT NULL;

ALTER TABLE transactions
  MODIFY COLUMN payment_method ENUM('bkash','nagad','rocket','card','bank_transfer','wallet','admin_credit','pay_later','cash','cheque') NULL;

ALTER TABLE transactions
  MODIFY COLUMN status ENUM('pending','completed','failed','reversed','approved','rejected') DEFAULT 'pending';
