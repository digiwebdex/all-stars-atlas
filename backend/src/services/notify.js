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
  const [rows] = await db.query("SELECT email FROM users WHERE role IN ('admin', 'super_admin')");
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
};
