
# Admin Panel — 9-Feature Enterprise Upgrade

This is a large multi-area request touching DB, backend, admin UI, and booking flow. Before I implement everything, I want to confirm scope and the partial-payment rules — getting these wrong means rework on live bookings.

---

## 1. Partial Payment Date Setup
- Admin can set the **due date** for the remaining balance on any partial booking (currently `payment_deadline` exists, but no admin UI to edit it).
- Add an "Edit Payment Deadline" action on `AdminBookings` detail → updates `bookings.payment_deadline`.
- Show this deadline on user dashboard booking detail.

## 2. Per-Client Commission (All Client Commission)
- New table `user_commission_overrides (user_id, discount_pct, ait_pct, notes)`.
- Admin → Users → "Set Commission" modal (per user).
- Booking fare calc reads override first, then global `system_settings.discount_pct` fallback.

## 3. Agent ID Create (Admin creates client account)
- Admin → Users → "Create New User" button.
- Form: name, email, phone, password, role (user/agent), initial wallet balance.
- POST `/api/admin/users` (create with hashed password, mark email_verified=true).

## 4. Deposit Approval Separation
- Today: all admin roles can approve deposits.
- Add new role `accounts` (or reuse `super_admin` with a `can_approve_deposits` flag).
- `AdminPaymentApprovals` page restricted to `super_admin` + users with `accounts` permission.
- Add permission column to `users` or a `admin_permissions` table.

## 5. Road-to-Road Airline Restrictions
- New table `airline_route_restrictions (airline_code, allowed_origin_country, allowed_dest_country, blocked_origin_country, blocked_dest_country)`.
- Admin → Markup/Airlines → "Route Restrictions" tab.
- Example: Saudia (SV) → block bookings where `arrival_country=BD`; allow `departure_country=BD`.
- Filter applied in `flights.js` search aggregation **and** at booking-create guard.

## 6. Issue Ticket — "In Progress" status
- When user clicks "Issue Ticket" (partial or full paid), booking status moves to `issue_in_progress` (already exists as `ticket_issue_requests` flow).
- Update dashboard badge: show **"Issue In Progress"** instead of "Processing" until admin issues the ticket.
- Update `DashboardBookings.tsx` status mapping.

## 7. Domain Change
- This is infra-level (DNS / Nginx). I'll document the steps in `DEPLOYMENT_COMMANDS.md` (update `server_name`, SSL cert renewal via certbot, update `FRONTEND_URL` in backend `.env`, update CORS origins in `server.js`).
- No code change unless you give me the new domain — please confirm the target domain.

## 8. B2C Partial Request Toggle
- New setting `system_settings.b2c_partial_enabled` (boolean).
- Admin → Settings → Booking → "Show Partial Payment to B2C users" toggle.
- Frontend `FlightBooking.tsx` hides "Pay Later / Partial" option when disabled OR when rules below fail.

## 9. Per-Airline Commission
- Extend `airline_markup_config` (already exists per memory) to include `commission_pct` and `discount_pct` per airline.
- Admin → Markup → per-airline row gets commission column.
- Fare calc: airline-specific override > user override > global default.

---

## Partial Payment Rules (NEW — strict)
Implement in `FlightBooking.tsx` + backend `flights.js` guard:

| Condition | Partial allowed? |
|---|---|
| Domestic flight | ❌ Never |
| International + non-refundable | ❌ |
| International + refundable + departure < 96h | ❌ |
| International + refundable + departure ≥ 96h | ✅ 30% pay, 70% balance |
| Admin override flag on booking | ✅ (force-enable) |

- Add `bookings.partial_override` boolean (admin can force-enable on a flight that normally wouldn't qualify).
- Admin → Booking Detail → "Allow Partial Payment" toggle.
- Default split: 30% upfront, 70% on `payment_deadline`.

---

## Technical Breakdown

**DB migrations (new file `backend/database/admin-enterprise-migration.sql`):**
- `user_commission_overrides`
- `airline_route_restrictions`
- `admin_permissions` (or add `can_approve_deposits`, `can_manage_bookings` columns to `users`)
- ALTER `bookings` ADD `partial_override BOOLEAN`, `partial_split_pct DECIMAL(5,2)`
- ALTER `airline_markup_config` ADD `commission_pct DECIMAL(5,2)`
- system_settings rows: `b2c_partial_enabled`, `partial_min_hours` (default 96), `partial_upfront_pct` (default 30)

**Backend routes:**
- `backend/src/routes/admin.js` — add: create-user, set-commission, set-deadline, set-partial-override, route-restrictions CRUD, permissions CRUD
- `backend/src/routes/flights.js` — apply route restrictions in search + book guard, apply per-airline/user commission
- `backend/src/routes/dashboard.js` — return `payment_deadline`, `partial_eligible` flag

**Frontend:**
- `src/pages/admin/AdminUsers.tsx` — "Create User", "Set Commission" buttons
- `src/pages/admin/AdminBookings.tsx` — "Edit Deadline", "Allow Partial" toggles
- `src/pages/admin/AdminMarkup.tsx` — per-airline commission column, route-restriction tab
- `src/pages/admin/AdminSettings.tsx` — B2C partial toggle, 96h threshold, 30% upfront
- `src/pages/flights/FlightBooking.tsx` — eligibility logic for partial option visibility
- `src/pages/dashboard/DashboardBookings.tsx` — "Issue In Progress" status mapping

---

## Questions before I start

1. **Domain change (#7)** — what is the new domain? (current: `seven-trip.com` / `booking.digiwebdex.com`). If just docs, I'll write the runbook.
2. **Deposit approver role (#4)** — should I add a new `accounts` role, or just a `can_approve_deposits` permission flag on existing admins?
3. **Partial split** — confirm **30% upfront / 70% balance** is the default (admin-editable)?

If you say "go" without answering, I'll: skip #7 code, use a `can_approve_deposits` flag, and default to 30/70.
