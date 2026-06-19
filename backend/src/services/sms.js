// SMS Service — BulkSMSBD Integration
// Reads API key from: 1) system_settings DB table, 2) .env fallback

const db = require('../config/db');
const BULKSMS_API = 'https://bulksmsbd.net/api/smsapi';

let cachedConfig = null;
let cacheTime = 0;
const CACHE_TTL = 60000; // 1 min

async function getConfig() {
  if (cachedConfig && Date.now() - cacheTime < CACHE_TTL) return cachedConfig;
  try {
    const [rows] = await db.query("SELECT setting_value FROM system_settings WHERE setting_key = 'api_sms_bulksmsbd'");
    if (rows.length > 0 && rows[0].setting_value) {
      const parsed = JSON.parse(rows[0].setting_value);
      if (parsed.api_key) {
        cachedConfig = { apiKey: parsed.api_key, senderId: parsed.sender_id || 'SevenTrip' };
        cacheTime = Date.now();
        return cachedConfig;
      }
    }
  } catch {}
  // Fallback to env
  cachedConfig = { apiKey: process.env.BULKSMS_API_KEY || '', senderId: process.env.BULKSMS_SENDER_ID || 'SevenTrip' };
  cacheTime = Date.now();
  return cachedConfig;
}

async function sendSMS(to, message) {
  const config = await getConfig();
  if (!config.apiKey) {
    console.warn('[SMS] No API key configured — skipping SMS to', to);
    return { success: false, reason: 'not_configured' };
  }

  // Normalize BD phone number
  let phone = String(to).replace(/[^0-9+]/g, '');
  if (phone.startsWith('0')) phone = '88' + phone;
  if (!phone.startsWith('880')) phone = '880' + phone;

  try {
    const url = `${BULKSMS_API}?api_key=${encodeURIComponent(config.apiKey)}&type=text&number=${phone}&senderid=${encodeURIComponent(config.senderId)}&message=${encodeURIComponent(message)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.response_code === 202 || data.success) {
      console.log(`[SMS] Sent to ${phone}`);
      return { success: true, messageId: data.message_id };
    } else {
      console.error('[SMS] Failed:', data);
      return { success: false, reason: data.error_message || 'unknown' };
    }
  } catch (err) {
    console.error('[SMS] Error:', err.message);
    return { success: false, reason: err.message };
  }
}

function otpSMS(otp) { return `Your Seven Trip verification code is: ${otp}. Valid for 10 minutes. Do not share this code.`; }
function bookingConfirmSMS(bookingRef, type) { return `Seven Trip: Your ${type} booking ${bookingRef} is confirmed! View details in your dashboard.`; }
function bookingStatusSMS(bookingRef, status) { return `Seven Trip: Booking ${bookingRef} status updated to "${status}". Check your dashboard.`; }
function paymentReceivedSMS(amount, ref) { return `Seven Trip: Payment of ৳${amount} received (Ref: ${ref}). Thank you!`; }
function visaStatusSMS(country, status) { return `Seven Trip: Your ${country} visa application is now "${status}". Check your dashboard.`; }
function welcomeSMS(name) { return `Welcome to Seven Trip, ${name}! Explore flights, hotels & more at seventrip.net`; }
function passwordResetSMS(otp) { return `Your Seven Trip password reset code: ${otp}. Valid for 10 minutes.`; }

module.exports = { sendSMS, otpSMS, bookingConfirmSMS, bookingStatusSMS, paymentReceivedSMS, visaStatusSMS, welcomeSMS, passwordResetSMS };
