// API endpoints
export const API_ENDPOINTS = {
  // Auth
  AUTH_LOGIN: '/auth/login',
  AUTH_REGISTER: '/auth/register',
  AUTH_LOGOUT: '/auth/logout',
  AUTH_REFRESH: '/auth/refresh',
  AUTH_FORGOT_PASSWORD: '/auth/forgot-password',
  AUTH_VERIFY_OTP: '/auth/verify-otp',
  AUTH_RESET_PASSWORD: '/auth/reset-password',

  // Flights
  FLIGHTS_SEARCH: '/flights/search',
  FLIGHTS_DETAILS: '/flights',
  FLIGHTS_BOOK: '/flights/book',
  FLIGHTS_CANCEL: '/flights/cancel',
  FLIGHTS_REVALIDATE: '/flights/revalidate-price',
  FLIGHTS_FARE_RULES: '/flights/fare-rules',
  FLIGHTS_STATUS: '/flights/status',
  FLIGHTS_VOID: '/flights/void',
  FLIGHTS_REFUND_PRICE: '/flights/refund/price',
  FLIGHTS_REFUND_FULFILL: '/flights/refund/fulfill',
  FLIGHTS_EXCHANGE: '/flights/exchange',
  FLIGHTS_ANCILLARIES: '/flights/ancillaries',
  FLIGHTS_ANCILLARIES_STATELESS: '/flights/ancillaries-stateless',
  FLIGHTS_ADD_ANCILLARY: '/flights/add-ancillary-stateless',
  FLIGHTS_FULFILL_TICKETS: '/flights/fulfill-tickets',
  FLIGHTS_UPDATE_FF: '/flights/update-frequent-flyer',
  FLIGHTS_SEATS: '/flights/seats-rest',
  FLIGHTS_ASSIGN_SEATS: '/flights/assign-seats',
  FLIGHTS_PURCHASE_ANCILLARY: '/flights/purchase-ancillary',
  FLIGHTS_BOOKING: '/flights/booking',
  FLIGHTS_TICKET_STATUS: '/flights/ticket-status',

  // Hotels
  HOTELS_SEARCH: '/hotels/search',
  HOTELS_DETAILS: '/hotels',
  HOTELS_BOOK: '/hotels/book',
  HOTELS_DEALS: '/hotels/deals',

  // Holidays
  HOLIDAYS_SEARCH: '/holidays/search',
  HOLIDAYS_DETAILS: '/holidays',
  HOLIDAYS_BOOK: '/holidays/book',

  // Visa
  VISA_COUNTRIES: '/visa/countries',
  VISA_APPLY: '/visa/apply',
  VISA_APPLICATIONS: '/visa/applications',

  // Medical
  MEDICAL_SEARCH: '/medical/search',
  MEDICAL_HOSPITALS: '/medical/hospitals',
  MEDICAL_BOOK: '/medical/book',

  // Cars
  CARS_SEARCH: '/cars/search',
  CARS_DETAILS: '/cars',
  CARS_BOOK: '/cars/book',

  // eSIM
  ESIM_PLANS: '/esim/plans',
  ESIM_PURCHASE: '/esim/purchase',
  ESIM_COUNTRIES: '/esim/countries',

  // Recharge
  RECHARGE_OPERATORS: '/recharge/operators',
  RECHARGE_SUBMIT: '/recharge/submit',

  // Pay Bill
  PAYBILL_CATEGORIES: '/paybill/categories',
  PAYBILL_BILLERS: '/paybill/billers',
  PAYBILL_SUBMIT: '/paybill/submit',

  // Payment Gateways
  PAYMENT_SSL_INIT: '/payments/ssl/init',
  PAYMENT_SSL_STATUS: '/payments/ssl/status',
  PAYMENT_BKASH_CREATE: '/payments/bkash/create',
  PAYMENT_BKASH_STATUS: '/payments/bkash/status',
  PAYMENT_NAGAD_INIT: '/payments/nagad/init',
  PAYMENT_NAGAD_STATUS: '/payments/nagad/status',
  PAYMENT_GATEWAYS_STATUS: '/payments/gateways/status',

  // Dashboard
  DASHBOARD_STATS: '/dashboard/stats',
  DASHBOARD_BOOKINGS: '/dashboard/bookings',
  DASHBOARD_TRANSACTIONS: '/dashboard/transactions',
  DASHBOARD_TRAVELLERS: '/dashboard/travellers',
  DASHBOARD_PAYMENTS: '/dashboard/payments',
  DASHBOARD_TICKETS: '/dashboard/tickets',
  DASHBOARD_WISHLIST: '/dashboard/wishlist',
  DASHBOARD_SETTINGS: '/dashboard/settings',
  DASHBOARD_SEARCH_HISTORY: '/dashboard/search-history',
  DASHBOARD_E_TRANSACTIONS: '/dashboard/e-transactions',
  DASHBOARD_PAY_LATER: '/dashboard/pay-later',
  DASHBOARD_INVOICES: '/dashboard/invoices',

  // Admin
  ADMIN_LOGIN: '/auth/admin/login',
  ADMIN_DASHBOARD: '/admin/dashboard',
  ADMIN_USERS: '/admin/users',
  ADMIN_BOOKINGS: '/admin/bookings',
  ADMIN_PAYMENTS: '/admin/payments',
  ADMIN_REPORTS: '/admin/reports',
  ADMIN_SETTINGS: '/admin/settings',
  ADMIN_VISA: '/admin/visa',
  ADMIN_DISCOUNTS: '/admin/discounts',
  ADMIN_INVOICES: '/admin/invoices',
  ADMIN_PAYMENT_APPROVALS: '/admin/payment-approvals',

  // CMS
  CMS_PAGES: '/admin/cms/pages',
  CMS_BLOG: '/admin/cms/blog',
  CMS_PROMOTIONS: '/admin/cms/promotions',
  CMS_DESTINATIONS: '/admin/cms/destinations',
  CMS_MEDIA: '/admin/cms/media',
  CMS_EMAIL_TEMPLATES: '/admin/cms/email-templates',

  // Contact
  CONTACT_SUBMIT: '/contact/submit',
} as const;

// Booking statuses — full 12-status lifecycle
export const BOOKING_STATUS = {
  PENDING: 'pending',
  ON_HOLD: 'on_hold',
  CONFIRMED: 'confirmed',
  TICKETED: 'ticketed',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  REFUNDED: 'refunded',
  FAILED: 'failed',
  EXPIRED: 'expired',
  NO_SHOW: 'no_show',
  PARTIALLY_REFUNDED: 'partially_refunded',
  PAYMENT_PENDING: 'payment_pending',
} as const;

// Payment methods
export const PAYMENT_METHODS = {
  BKASH: 'bkash',
  NAGAD: 'nagad',
  ROCKET: 'rocket',
  CARD: 'card',
  BANK_TRANSFER: 'bank_transfer',
  SSLCOMMERZ: 'sslcommerz',
  PAY_LATER: 'pay_later',
} as const;

// User roles
export const USER_ROLES = {
  CUSTOMER: 'customer',
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin',
} as const;

// Visa statuses
export const VISA_STATUS = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  PROCESSING: 'processing',
  UNDER_REVIEW: 'under_review',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  COLLECTED: 'collected',
} as const;

// Cabin classes
export const CABIN_CLASSES = ['Economy', 'Premium Economy', 'Business', 'First'] as const;

// Treatment types for medical tourism
export const TREATMENT_TYPES = [
  'General Checkup', 'Cardiac Surgery', 'Orthopedic', 'Dental',
  'Eye Care', 'Cosmetic Surgery', 'Fertility Treatment', 'Cancer Treatment',
  'Neurology', 'Organ Transplant',
] as const;

// Car types
export const CAR_TYPES = [
  'Economy', 'Compact', 'Sedan', 'SUV', 'Luxury', 'Van', 'Minibus',
] as const;

// Recharge operators (BD) — used as UI fallback when API is unavailable
export const RECHARGE_OPERATORS = [
  { id: 'grameenphone', name: 'Grameenphone', logo: '🟢' },
  { id: 'robi', name: 'Robi', logo: '🔴' },
  { id: 'banglalink', name: 'Banglalink', logo: '🟠' },
  { id: 'airtel', name: 'Airtel', logo: '🔵' },
  { id: 'teletalk', name: 'Teletalk', logo: '🟣' },
] as const;

// Bill categories — used as UI fallback when API is unavailable
export const BILL_CATEGORIES = [
  'Electricity', 'Gas', 'Water', 'Internet', 'TV Cable', 'Insurance',
  'Education', 'Government Fees', 'Credit Card',
] as const;
