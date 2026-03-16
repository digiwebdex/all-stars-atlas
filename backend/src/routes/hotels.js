const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { notifyBookingConfirm } = require('../services/notify');
const { safeJsonParse } = require('../utils/json');
const { searchHotels: hbSearch, getHotelBedsConfig } = require('./hotelbeds');
const { searchHotels: sabreSearch, getHotelDetails: sabreDetails, bookHotel: sabreBook, getTopHotelDeals } = require('./sabre-hotels');

const router = express.Router();

// GET /hotels/deals — Live hotel deals for homepage (Sabre, cached hourly)
router.get('/deals', async (req, res) => {
  try {
    const deals = await getTopHotelDeals();
    res.json({ success: true, deals, total: deals.length, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Hotel deals error:', err);
    res.json({ success: false, deals: [], total: 0 });
  }
});

// GET /hotels/search — Multi-provider: DB + HotelBeds + Sabre
router.get('/search', async (req, res) => {
  try {
    const { city, checkIn, checkOut, minPrice, maxPrice, starRating, adults, children, rooms, page = 1, limit = 20, destination, location } = req.query;
    const searchCity = city || destination || location || '';

    // DB search
    let sql = 'SELECT * FROM hotels WHERE available = 1';
    const params = [];
    if (searchCity) { sql += ' AND city LIKE ?'; params.push(`%${searchCity}%`); }
    if (minPrice) { sql += ' AND price_per_night >= ?'; params.push(parseFloat(minPrice)); }
    if (maxPrice) { sql += ' AND price_per_night <= ?'; params.push(parseFloat(maxPrice)); }
    if (starRating) { sql += ' AND star_rating >= ?'; params.push(parseInt(starRating)); }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const [countResult] = await db.query(sql.replace('SELECT *', 'SELECT COUNT(*) as total'), params);
    sql += ` ORDER BY user_rating DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);

    const [rows] = await db.query(sql, params);
    const dbData = rows.map(r => ({
      id: r.id, source: 'db', name: r.name, city: r.city, country: r.country, address: r.address,
      starRating: r.star_rating, stars: r.star_rating, userRating: r.user_rating ? parseFloat(r.user_rating) : null,
      reviewCount: r.review_count, reviews: r.review_count || 0,
      pricePerNight: parseFloat(r.price_per_night), price: parseFloat(r.price_per_night), currency: r.currency,
      images: safeJsonParse(r.images, []), img: safeJsonParse(r.images, [])[0] || '',
      amenities: safeJsonParse(r.amenities, []), description: r.description,
      location: `${r.city || ''}, ${r.country || ''}`.replace(/, $/, ''),
      rating: r.user_rating ? parseFloat(r.user_rating) : null,
    }));

    // Provider searches in parallel: HotelBeds + Sabre
    const providerSearches = [];

    // HotelBeds
    if (searchCity && checkIn && checkOut) {
      providerSearches.push(
        hbSearch({ city: searchCity, checkIn, checkOut, adults: adults || 2, children: children || 0, rooms: rooms || 1, minRate: minPrice, maxRate: maxPrice, minStars: starRating })
          .then(data => data.map(h => ({ ...h, source: 'hotelbeds' })))
          .catch(err => { console.error('HotelBeds search failed:', err.message); return []; })
      );
    }

    // Sabre
    if (searchCity && checkIn && checkOut) {
      providerSearches.push(
        sabreSearch({ city: searchCity, checkIn, checkOut, adults: adults || 2, children: children || 0, rooms: rooms || 1, minRate: minPrice, maxRate: maxPrice, minStars: starRating })
          .catch(err => { console.error('Sabre Hotels search failed:', err.message); return []; })
      );
    }

    const providerResults = await Promise.allSettled(providerSearches);
    let hbData = [];
    let sabreData = [];
    
    for (const result of providerResults) {
      if (result.status === 'fulfilled' && Array.isArray(result.value)) {
        const first = result.value[0];
        if (first?.source === 'hotelbeds') hbData = result.value;
        else if (first?.source === 'sabre') sabreData = result.value;
      }
    }

    // Merge all — deduplicate by name similarity
    const allHotels = deduplicateHotels([...dbData, ...sabreData, ...hbData]);
    const total = allHotels.length;

    res.json({
      data: allHotels,
      hotels: allHotels,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit)),
      sources: { db: dbData.length, sabre: sabreData.length, hotelbeds: hbData.length },
      searchMeta: { location: searchCity, checkIn, checkOut, providers: ['db', 'sabre', 'hotelbeds'] },
    });
  } catch (err) {
    console.error('Hotel search error:', err);
    res.status(500).json({ message: 'Something went wrong', status: 500 });
  }
});

// Deduplicate hotels with similar names from different providers
function deduplicateHotels(hotels) {
  const seen = new Map();
  const result = [];

  for (const hotel of hotels) {
    const key = (hotel.name || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);
    if (seen.has(key)) {
      // Keep the one with lower price
      const existing = seen.get(key);
      if ((hotel.pricePerNight || hotel.price || 99999) < (existing.pricePerNight || existing.price || 99999)) {
        const idx = result.indexOf(existing);
        if (idx >= 0) result[idx] = hotel;
        seen.set(key, hotel);
      }
    } else {
      seen.set(key, hotel);
      result.push(hotel);
    }
  }
  return result;
}

// GET /hotels/details/:code — Sabre hotel details
router.get('/details/:code', async (req, res) => {
  try {
    const code = req.params.code;
    // If it's a Sabre code (starts with sabre-), extract
    const sabreCode = code.startsWith('sabre-') ? code.replace('sabre-', '') : code;

    // Try Sabre details
    const details = await sabreDetails(sabreCode);
    if (details) {
      return res.json(details);
    }

    // Fallback: DB lookup
    const [rows] = await db.query('SELECT * FROM hotels WHERE id = ?', [code]);
    if (rows.length === 0) return res.status(404).json({ message: 'Hotel not found', status: 404 });
    const r = rows[0];
    res.json({
      id: r.id, name: r.name, city: r.city, country: r.country, address: r.address,
      starRating: r.star_rating, userRating: r.user_rating ? parseFloat(r.user_rating) : null,
      reviewCount: r.review_count, pricePerNight: parseFloat(r.price_per_night), currency: r.currency,
      images: safeJsonParse(r.images, []), amenities: safeJsonParse(r.amenities, []),
      description: r.description, latitude: r.latitude, longitude: r.longitude,
      source: 'db',
    });
  } catch (err) {
    console.error('Hotel detail error:', err);
    res.status(500).json({ message: 'Something went wrong', status: 500 });
  }
});

// GET /hotels/:id — DB-only detail (legacy)
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM hotels WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Hotel not found', status: 404 });
    const r = rows[0];
    res.json({
      id: r.id, name: r.name, city: r.city, country: r.country, address: r.address,
      starRating: r.star_rating, userRating: r.user_rating ? parseFloat(r.user_rating) : null,
      reviewCount: r.review_count, pricePerNight: parseFloat(r.price_per_night), currency: r.currency,
      images: safeJsonParse(r.images, []), amenities: safeJsonParse(r.amenities, []),
      description: r.description, latitude: r.latitude, longitude: r.longitude,
      source: 'db',
    });
  } catch (err) {
    console.error('Hotel detail error:', err);
    res.status(500).json({ message: 'Something went wrong', status: 500 });
  }
});

// POST /hotels/book — Multi-provider booking
router.post('/book', authenticate, async (req, res) => {
  try {
    const { hotelId, hotelCode, checkIn, checkOut, rooms, guests, contactInfo, paymentMethod, paymentInfo, source, rateKey } = req.body;
    const bookingId = uuidv4();
    const bookingRef = `HT${String(Date.now()).slice(-8)}`;

    let sabrePnr = null;
    let sabreConfirmation = null;

    // If Sabre hotel, attempt GDS booking
    if (source === 'sabre' && hotelCode) {
      try {
        const sabreResult = await sabreBook({
          hotelCode: hotelCode.replace('sabre-', ''),
          rateKey,
          checkIn,
          checkOut,
          rooms: rooms ? [{ adults: rooms }] : [{ adults: 2 }],
          guests: guests || [],
          contactInfo: contactInfo || {},
          paymentInfo: paymentInfo || null,
        });
        sabrePnr = sabreResult.pnr;
        sabreConfirmation = sabreResult.confirmationNumber;
      } catch (err) {
        console.error('[Hotels] Sabre booking failed:', err.message);
        // Continue with DB-only booking as fallback
      }
    }

    // Calculate amount
    let totalAmount = 0;
    const resolvedHotelId = hotelId || hotelCode;

    if (resolvedHotelId && !String(resolvedHotelId).startsWith('sabre-')) {
      const [hotels] = await db.query('SELECT * FROM hotels WHERE id = ?', [resolvedHotelId]);
      const nights = checkIn && checkOut ? Math.max(1, Math.ceil((new Date(checkOut) - new Date(checkIn)) / 86400000)) : 1;
      totalAmount = hotels.length > 0 ? parseFloat(hotels[0].price_per_night) * nights * (rooms || 1) : 0;
    } else if (req.body.totalAmount) {
      totalAmount = parseFloat(req.body.totalAmount);
    }

    const details = {
      hotel: req.body.hotelName || 'Hotel',
      checkIn, checkOut, rooms,
      source: source || 'db',
      sabrePnr,
      sabreConfirmation,
      hotelCode: hotelCode || hotelId,
    };

    await db.query(
      `INSERT INTO bookings (id, user_id, booking_type, booking_ref, status, total_amount, payment_method, payment_status, details, passenger_info, contact_info)
       VALUES (?, ?, 'hotel', ?, ?, ?, ?, 'paid', ?, ?, ?)`,
      [bookingId, req.user.sub, bookingRef, sabrePnr ? 'confirmed' : 'pending', totalAmount, paymentMethod || 'card',
       JSON.stringify(details), JSON.stringify(guests || []), JSON.stringify(contactInfo || {})]
    );

    await db.query(
      `INSERT INTO transactions (id, user_id, booking_id, type, amount, status, payment_method, reference, description)
       VALUES (?, ?, ?, 'payment', ?, 'completed', ?, ?, ?)`,
      [uuidv4(), req.user.sub, bookingId, totalAmount, paymentMethod || 'card', bookingRef, `Hotel booking${sabrePnr ? ' (PNR: ' + sabrePnr + ')' : ''}`]
    );

    notifyBookingConfirm(req.user.sub, { bookingRef, type: 'Hotel', amount: totalAmount }).catch(console.error);

    res.status(201).json({
      id: bookingId, bookingRef,
      status: sabrePnr ? 'confirmed' : 'pending',
      totalAmount, currency: 'BDT', bookingType: 'hotel',
      sabrePnr, sabreConfirmation,
      source: source || 'db',
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Hotel booking error:', err);
    res.status(500).json({ message: 'Something went wrong', status: 500 });
  }
});

module.exports = router;
