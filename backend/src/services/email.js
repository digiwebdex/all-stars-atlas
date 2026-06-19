// Email Service — Resend Integration
// Reads API key from: 1) system_settings DB table, 2) .env fallback

const db = require('../config/db');
const RESEND_API = 'https://api.resend.com/emails';

let cachedConfig = null;
let cacheTime = 0;
const CACHE_TTL = 60000;

async function getConfig() {
  if (cachedConfig && Date.now() - cacheTime < CACHE_TTL) return cachedConfig;
  try {
    const [rows] = await db.query("SELECT setting_value FROM system_settings WHERE setting_key = 'api_email_resend'");
    if (rows.length > 0 && rows[0].setting_value) {
      const parsed = JSON.parse(rows[0].setting_value);
      if (parsed.api_key) {
        cachedConfig = { apiKey: parsed.api_key, from: parsed.from_email || 'Seven Trip <noreply@seventrip.net>' };
        cacheTime = Date.now();
        return cachedConfig;
      }
    }
  } catch {}
  cachedConfig = { apiKey: process.env.RESEND_API_KEY || '', from: process.env.EMAIL_FROM || 'Seven Trip <noreply@seventrip.net>' };
  cacheTime = Date.now();
  return cachedConfig;
}

async function sendEmail({ to, subject, html, text }) {
  const config = await getConfig();
  if (!config.apiKey) {
    console.warn('[EMAIL] No API key configured — skipping email to', to);
    return { success: false, reason: 'not_configured' };
  }

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.from, to: Array.isArray(to) ? to : [to], subject, html: html || undefined, text: text || undefined }),
    });
    const data = await res.json();
    if (res.ok) {
      console.log(`[EMAIL] Sent to ${to}: ${subject}`);
      return { success: true, id: data.id };
    } else {
      console.error('[EMAIL] Failed:', data);
      return { success: false, reason: data.message || 'unknown' };
    }
  } catch (err) {
    console.error('[EMAIL] Error:', err.message);
    return { success: false, reason: err.message };
  }
}

// ============ TEMPLATES ============
const FRONTEND = () => process.env.FRONTEND_URL || 'https://seventrip.net';
const YEAR = () => new Date().getFullYear();
const wrap = (body) => `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;"><div style="text-align:center;padding:20px 0;border-bottom:2px solid #0ea5e9;"><h1 style="color:#0ea5e9;margin:0;">Seven Trip</h1></div><div style="padding:30px 0;">${body}</div><div style="text-align:center;padding:20px 0;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;"><p>© ${YEAR()} Seven Trip. All rights reserved.</p></div></div>`;

function otpEmail(name, otp) {
  return { subject: 'Your Seven Trip Verification Code', html: wrap(`<p>Hi ${name || 'there'},</p><p>Your verification code is:</p><div style="text-align:center;margin:30px 0;"><span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#0ea5e9;background:#f0f9ff;padding:15px 30px;border-radius:8px;">${otp}</span></div><p>This code expires in <strong>10 minutes</strong>.</p>`) };
}

function welcomeEmail(name) {
  return { subject: 'Welcome to Seven Trip! 🎉', html: wrap(`<h2>Welcome aboard, ${name}! 🎉</h2><p>Your account is ready. Here's what you can do:</p><ul style="line-height:2;"><li>✈️ Search & book flights</li><li>🏨 Find hotels worldwide</li><li>🏝️ Explore holiday packages</li><li>🛂 Apply for visas</li><li>🏥 Medical tourism</li><li>🚗 Rent cars</li></ul><div style="text-align:center;margin:30px 0;"><a href="${FRONTEND()}" style="background:#0ea5e9;color:white;padding:12px 30px;border-radius:6px;text-decoration:none;font-weight:bold;">Start Exploring</a></div>`) };
}

function bookingConfirmEmail(name, booking) {
  return { subject: `Booking Confirmed: ${booking.bookingRef}`, html: wrap(`<h2>Booking Confirmed! ✅</h2><p>Hi ${name},</p><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:20px 0;"><table style="width:100%;border-collapse:collapse;"><tr><td style="padding:8px 0;color:#64748b;">Ref</td><td style="padding:8px 0;font-weight:bold;text-align:right;">${booking.bookingRef}</td></tr><tr><td style="padding:8px 0;color:#64748b;">Type</td><td style="padding:8px 0;text-align:right;">${booking.type}</td></tr><tr><td style="padding:8px 0;color:#64748b;">Amount</td><td style="padding:8px 0;font-weight:bold;text-align:right;">৳${booking.amount}</td></tr></table></div><div style="text-align:center;margin:30px 0;"><a href="${FRONTEND()}/dashboard/bookings" style="background:#0ea5e9;color:white;padding:12px 30px;border-radius:6px;text-decoration:none;">View Booking</a></div>`) };
}

function bookingStatusEmail(name, bookingRef, status) {
  const c = { confirmed:'#16a34a', cancelled:'#dc2626', pending:'#f59e0b', processing:'#3b82f6' };
  return { subject: `Booking ${bookingRef} — ${status}`, html: wrap(`<p>Hi ${name},</p><p>Booking <strong>${bookingRef}</strong> is now:</p><div style="text-align:center;margin:20px 0;"><span style="font-size:18px;font-weight:bold;color:${c[status]||'#64748b'};background:#f0f9ff;padding:10px 25px;border-radius:20px;">${status.toUpperCase()}</span></div><div style="text-align:center;margin:30px 0;"><a href="${FRONTEND()}/dashboard/bookings" style="background:#0ea5e9;color:white;padding:12px 30px;border-radius:6px;text-decoration:none;">View Details</a></div>`) };
}

function paymentReceivedEmail(name, amount, ref) {
  return { subject: `Payment Received: ৳${amount}`, html: wrap(`<h2>Payment Received ✅</h2><p>Hi ${name},</p><p>We've received your payment of <strong>৳${amount}</strong>.</p><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:20px 0;"><p style="margin:0;">Reference: <strong>${ref}</strong></p></div>`) };
}

function visaStatusEmail(name, country, status, notes) {
  const c = status==='approved'?'#16a34a':status==='rejected'?'#dc2626':'#3b82f6';
  const bg = status==='approved'?'#dcfce7':status==='rejected'?'#fef2f2':'#f0f9ff';
  return { subject: `Visa Update: ${country} — ${status}`, html: wrap(`<h2>Visa Application Update</h2><p>Hi ${name},</p><p>Your <strong>${country}</strong> visa:</p><div style="text-align:center;margin:20px 0;"><span style="font-size:18px;font-weight:bold;padding:10px 25px;border-radius:20px;background:${bg};color:${c};">${status.toUpperCase()}</span></div>${notes?`<p style="background:#f8fafc;padding:15px;border-radius:8px;border-left:4px solid #0ea5e9;"><strong>Note:</strong> ${notes}</p>`:''}<div style="text-align:center;margin:30px 0;"><a href="${FRONTEND()}/dashboard/bookings" style="background:#0ea5e9;color:white;padding:12px 30px;border-radius:6px;text-decoration:none;">View Application</a></div>`) };
}

function contactAutoReplyEmail(name) {
  return { subject: 'We received your message — Seven Trip', html: wrap(`<p>Hi ${name},</p><p>Thank you for contacting Seven Trip! We'll get back to you within <strong>24 hours</strong>.</p><p>For urgent matters, call <strong>+880 1234-567890</strong>.</p>`) };
}

function adminNotifyEmail(subject, message) {
  return { subject: `[Admin] ${subject}`, html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;"><div style="text-align:center;padding:20px 0;border-bottom:2px solid #ef4444;"><h1 style="color:#ef4444;margin:0;">Seven Trip Admin</h1></div><div style="padding:30px 0;"><h2>${subject}</h2><p>${message}</p><div style="text-align:center;margin:30px 0;"><a href="${FRONTEND()}/admin" style="background:#ef4444;color:white;padding:12px 30px;border-radius:6px;text-decoration:none;">Go to Admin Panel</a></div></div></div>` };
}

function passwordResetEmail(name, otp) {
  return { subject: 'Password Reset — Seven Trip', html: wrap(`<p>Hi ${name || 'there'},</p><p>Your password reset code:</p><div style="text-align:center;margin:30px 0;"><span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#0ea5e9;background:#f0f9ff;padding:15px 30px;border-radius:8px;">${otp}</span></div><p>Expires in <strong>10 minutes</strong>.</p><p style="color:#6b7280;font-size:13px;">If you didn't request this, ignore this email.</p>`) };
}

module.exports = { sendEmail, otpEmail, welcomeEmail, bookingConfirmEmail, bookingStatusEmail, paymentReceivedEmail, visaStatusEmail, contactAutoReplyEmail, adminNotifyEmail, passwordResetEmail };
