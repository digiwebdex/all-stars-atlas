// Notification helper — sends both SMS + Email where applicable
const { sendSMS, otpSMS, bookingConfirmSMS, bookingStatusSMS, paymentReceivedSMS, visaStatusSMS, welcomeSMS, passwordResetSMS } = require('./sms');
const { sendEmail, otpEmail, welcomeEmail, bookingConfirmEmail, bookingStatusEmail, paymentReceivedEmail, visaStatusEmail, contactAutoReplyEmail, adminNotifyEmail, passwordResetEmail } = require('./email');
const db = require('../config/db');

// Helper to get user info
async function getUser(userId) {
  const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
  return rows[0] || null;
}

// Helper to get admin emails
async function getAdminEmails() {
  const [rows] = await db.query("SELECT email FROM users WHERE role IN ('admin', 'super_admin', 'secondary_admin')");
  return rows.map(r => r.email);
}

// ============ NOTIFICATION FUNCTIONS ============

// Notify all admins (email) about a system event — new booking, new ID created, etc.
async function notifyAdminsEvent(subject, lines = []) {
  try {
    const emails = await getAdminEmails();
    if (!emails.length) return;
    const html = `<h2>${subject}</h2><ul>${lines.map(l => `<li>${l}</li>`).join('')}</ul>`;
    return Promise.allSettled(
      emails.map(to => sendEmail({ to, subject: `[Seven Trip] ${subject}`, html, text: `${subject}\n${lines.join('\n')}` }))
    );
  } catch (err) {
    console.error('notifyAdminsEvent error:', err.message);
  }
}

async function notifyOTP(email, phone, name, otp) {
  const promises = [];
  if (email) {
    const tpl = otpEmail(name, otp);
    promises.push(sendEmail({ to: email, ...tpl }));
  }
  if (phone) {
    promises.push(sendSMS(phone, otpSMS(otp)));
  }
  return Promise.allSettled(promises);
}

async function notifyPasswordReset(email, phone, name, otp) {
  const promises = [];
  if (email) {
    const tpl = passwordResetEmail(name, otp);
    promises.push(sendEmail({ to: email, ...tpl }));
  }
  if (phone) {
    promises.push(sendSMS(phone, passwordResetSMS(otp)));
  }
  return Promise.allSettled(promises);
}

async function notifyWelcome(userId) {
  const user = await getUser(userId);
  if (!user) return;
  const name = `${user.first_name} ${user.last_name}`.trim();
  const promises = [];
  const tpl = welcomeEmail(name);
  promises.push(sendEmail({ to: user.email, ...tpl }));
  if (user.phone) promises.push(sendSMS(user.phone, welcomeSMS(name)));
  // Notify admins
  const admins = await getAdminEmails();
  if (admins.length > 0) {
    const adminTpl = adminNotifyEmail('New User Registration', `${name} (${user.email}) just registered on Seven Trip.`);
    promises.push(sendEmail({ to: admins, ...adminTpl }));
  }
  return Promise.allSettled(promises);
}

async function notifyBookingConfirm(userId, booking) {
  const user = await getUser(userId);
  if (!user) return;
  const name = `${user.first_name} ${user.last_name}`.trim();
  const promises = [];
  const tpl = bookingConfirmEmail(name, booking);
  promises.push(sendEmail({ to: user.email, ...tpl }));
  if (user.phone) promises.push(sendSMS(user.phone, bookingConfirmSMS(booking.bookingRef, booking.type)));
  // Notify admins
  const admins = await getAdminEmails();
  if (admins.length > 0) {
    const adminTpl = adminNotifyEmail('New Booking', `${name} booked ${booking.type} (${booking.bookingRef}) — ৳${booking.amount}`);
    promises.push(sendEmail({ to: admins, ...adminTpl }));
  }
  return Promise.allSettled(promises);
}

async function notifyBookingStatus(userId, bookingRef, status) {
  const user = await getUser(userId);
  if (!user) return;
  const name = `${user.first_name} ${user.last_name}`.trim();
  const promises = [];
  const tpl = bookingStatusEmail(name, bookingRef, status);
  promises.push(sendEmail({ to: user.email, ...tpl }));
  if (user.phone) promises.push(sendSMS(user.phone, bookingStatusSMS(bookingRef, status)));
  return Promise.allSettled(promises);
}

async function notifyPayment(userId, amount, ref) {
  const user = await getUser(userId);
  if (!user) return;
  const name = `${user.first_name} ${user.last_name}`.trim();
  const promises = [];
  const tpl = paymentReceivedEmail(name, amount, ref);
  promises.push(sendEmail({ to: user.email, ...tpl }));
  if (user.phone) promises.push(sendSMS(user.phone, paymentReceivedSMS(amount, ref)));
  return Promise.allSettled(promises);
}

async function notifyVisaStatus(userId, country, status, notes) {
  const user = await getUser(userId);
  if (!user) return;
  const name = `${user.first_name} ${user.last_name}`.trim();
  const promises = [];
  const tpl = visaStatusEmail(name, country, status, notes);
  promises.push(sendEmail({ to: user.email, ...tpl }));
  if (user.phone) promises.push(sendSMS(user.phone, visaStatusSMS(country, status)));
  return Promise.allSettled(promises);
}

async function notifyContactSubmission(contactName, contactEmail) {
  const promises = [];
  const tpl = contactAutoReplyEmail(contactName);
  promises.push(sendEmail({ to: contactEmail, ...tpl }));
  // Notify admins
  const admins = await getAdminEmails();
  if (admins.length > 0) {
    const adminTpl = adminNotifyEmail('New Contact Submission', `${contactName} (${contactEmail}) submitted a contact form.`);
    promises.push(sendEmail({ to: admins, ...adminTpl }));
  }
  return Promise.allSettled(promises);
}

// ============ POST-TICKET SERVICE REQUESTS (void / refund / reissue) ============
// IMPORTANT: These requests are never sent to any airline / GDS API automatically.
// They only land in the admin panel and are emailed to the configured inbox(es).
async function getServiceRequestInbox() {
  const list = [];
  try {
    const [rows] = await db.query("SELECT setting_value FROM system_settings WHERE setting_key = 'api_service_request_alerts' LIMIT 1");
    if (rows.length && rows[0].setting_value) {
      const cfg = JSON.parse(rows[0].setting_value);
      if (cfg && String(cfg.enabled) !== 'false' && cfg.emails) {
        String(cfg.emails).split(/[,;\s]+/).forEach((e) => { if (e && e.includes('@')) list.push(e.trim()); });
      }
    }
  } catch {}
  if (!list.length) {
    try { (await getAdminEmails()).forEach((e) => { if (e) list.push(e); }); } catch {}
  }
  return [...new Set(list)];
}

async function notifyServiceRequest({ type, bookingRef, pnr, customerName, customerEmail, customerPhone, notes }) {
  try {
    const to = await getServiceRequestInbox();
    if (!to.length) return;
    const label = String(type || '').toUpperCase();
    const lines = [
      `Request type: <strong>${label}</strong>`,
      `Booking Ref: <strong>${bookingRef || '-'}</strong>`,
      `PNR: <strong>${pnr || '-'}</strong>`,
      `Customer: ${customerName || '-'} (${customerEmail || '-'} / ${customerPhone || '-'})`,
      `Customer note: ${notes || '-'}`,
      `Action: review & send quotation from Admin → Void / Refund / Reissue. No airline API call was made.`,
    ];
    const tpl = adminNotifyEmail(`New ${label} Request — ${bookingRef || ''}`.trim(), `<ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>`);
    return Promise.allSettled(to.map((addr) => sendEmail({ to: addr, ...tpl })));
  } catch (err) {
    console.error('notifyServiceRequest error:', err.message);
  }
}

module.exports = {
  notifyAdminsEvent,
  notifyOTP,
  notifyPasswordReset,
  notifyWelcome,
  notifyBookingConfirm,
  notifyBookingStatus,
  notifyPayment,
  notifyVisaStatus,
  notifyContactSubmission,
  notifyServiceRequest,
};
