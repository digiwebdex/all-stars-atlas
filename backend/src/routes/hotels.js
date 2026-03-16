const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { notifyBookingConfirm } = require('../services/notify');
const { safeJsonParse } = require('../utils/json');
const { searchHotels: hbSearch, getHotelBedsConfig } = require('./hotelbeds');
const { searchHotels: sabreSearch, getHotelDetails: sabreDetails, bookHotel: sabreBook, getTopHotelDeals } = require('./sabre-hotels');

const router = express.Router();

// GET /hotels/deals — Live hotel deals for homepage
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
    const { city, checkIn, checkOut, minPrice, maxPrice, starRating, adults = 2, children = 0, rooms = 1, page = 1, limit = 50, destination, location, sort } = req.query;
    const searchCity = city || destination || location || '';

    // DB search
    let sql = 'SELECT * FROM hotels WHERE available = 1';
    const params = [];
    if (searchCity) { sql += ' AND city LIKE ?'; params.push(`%${searchCity}%`); }
    if (minPrice) { sql += ' AND price_per_night >= ?'; params.push(parseFloat(minPrice)); }
    if (maxPrice) { sql += ' AND price_per_night <= ?'; params.push(parseFloat(maxPrice)); }
    if (starRating) { sql += ' AND star_rating >= ?'; params.push(parseInt(starRating)); }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    sql += ` ORDER BY user_rating DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);

    const [rows] = await db.query(sql, params);
    const dbData = rows.map(r => ({
      id: r.id, source: 'db', name: r.name, city: r.city, country: r.country, address: r.address,
      starRating: r.star_rating, stars: r.star_rating, userRating: r.user_rating ? parseFloat(r.user_rating) : null,
      rating: r.user_rating ? parseFloat(r.user_rating) : null,
      reviewCount: r.review_count, reviews: r.review_count || 0,
      pricePerNight: parseFloat(r.price_per_night), price: parseFloat(r.price_per_night), currency: r.currency || 'BDT',
      images: safeJsonParse(r.images, []), img: safeJsonParse(r.images, [])[0] || '',
      amenities: safeJsonParse(r.amenities, []), description: r.description,
      location: `${r.city || ''}, ${r.country || ''}`.replace(/, $/, ''),
      tags: [], isFreeCancellation: false,
    }));

    // Provider searches in parallel
    const providerSearches = [];

    if (searchCity && checkIn && checkOut) {
      // Sabre
      providerSearches.push(
        sabreSearch({ city: searchCity, checkIn, checkOut, adults, children, rooms, minRate: minPrice, maxRate: maxPrice, minStars: starRating })
          .catch(err => { console.error('Sabre Hotels search failed:', err.message); return []; })
      );

      // HotelBeds
      providerSearches.push(
        hbSearch({ city: searchCity, checkIn, checkOut, adults: adults || 2, children: children || 0, rooms: rooms || 1, minRate: minPrice, maxRate: maxPrice, minStars: starRating })
          .then(data => data.map(h => ({ ...h, source: 'hotelbeds' })))
          .catch(err => { console.error('HotelBeds search failed:', err.message); return []; })
      );
    }

    const providerResults = await Promise.allSettled(providerSearches);
    let sabreData = [];
    let hbData = [];
    
    for (const result of providerResults) {
      if (result.status === 'fulfilled' && Array.isArray(result.value)) {
        const first = result.value[0];
        if (first?.source === 'sabre') sabreData = result.value;
        else if (first?.source === 'hotelbeds') hbData = result.value;
      }
    }

    // Merge and deduplicate
    let allHotels = deduplicateHotels([...sabreData, ...hbData, ...dbData]);

    // Sort
    if (sort === 'price-low') allHotels.sort((a, b) => (a.price || 0) - (b.price || 0));
    else if (sort === 'price-high') allHotels.sort((a, b) => (b.price || 0) - (a.price || 0));
    else if (sort === 'rating') allHotels.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    else if (sort === 'stars') allHotels.sort((a, b) => (b.stars || 0) - (a.stars || 0));
    // Default: recommended (Sabre first, then by rating)
    else allHotels.sort((a, b) => {
      const sourceOrder = { sabre: 0, hotelbeds: 1, db: 2 };
      const sDiff = (sourceOrder[a.source] || 2) - (sourceOrder[b.source] || 2);
      if (sDiff !== 0) return sDiff;
      return (b.rating || 0) - (a.rating || 0);
    });

    const total = allHotels.length;

    res.json({
      data: allHotels,
      hotels: allHotels,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit)),
      sources: { db: dbData.length, sabre: sabreData.length, hotelbeds: hbData.length },
      searchMeta: { location: searchCity, checkIn, checkOut, adults, children, rooms, providers: ['sabre', 'hotelbeds', 'db'] },
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
    if (!key) { result.push(hotel); continue; }
    
    if (seen.has(key)) {
      const existing = seen.get(key);
      if ((hotel.price || 99999) < (existing.price || 99999)) {
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

// GET /hotels/details/:code — Sabre hotel details with rates
router.get('/details/:code', async (req, res) => {
  try {
    const code = req.params.code;
    const { checkIn, checkOut, adults, rooms } = req.query;
    const sabreCode = code.startsWith('sabre-') ? code.replace('sabre-', '') : code;

    // Try Sabre details
    const details = await sabreDetails(sabreCode, checkIn, checkOut, adults, rooms);
    if (details) {
      return res.json({ hotel: details });
    }

    // Fallback: DB lookup
    const [rows] = await db.query('SELECT * FROM hotels WHERE id = ?', [code]);
    if (rows.length === 0) return res.status(404).json({ message: 'Hotel not found', status: 404 });
    const r = rows[0];
    res.json({
      hotel: {
        id: r.id, name: r.name, city: r.city, country: r.country, address: r.address,
        starRating: r.star_rating, stars: r.star_rating,
        userRating: r.user_rating ? parseFloat(r.user_rating) : null,
        rating: r.user_rating ? parseFloat(r.user_rating) : null,
        reviewCount: r.review_count, reviews: r.review_count || 0,
        pricePerNight: parseFloat(r.price_per_night), price: parseFloat(r.price_per_night),
        currency: r.currency || 'BDT',
        images: safeJsonParse(r.images, []), amenities: safeJsonParse(r.amenities, []),
        description: r.description, latitude: r.latitude, longitude: r.longitude,
        location: `${r.city || ''}, ${r.country || ''}`.replace(/, $/, ''),
        source: 'db',
        rooms: safeJsonParse(r.rooms, []),
        policies: [],
        checkInTime: '15:00', checkOutTime: '11:00',
      }
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
      hotel: {
        id: r.id, name: r.name, city: r.city, country: r.country, address: r.address,
        starRating: r.star_rating, stars: r.star_rating,
        userRating: r.user_rating ? parseFloat(r.user_rating) : null,
        rating: r.user_rating ? parseFloat(r.user_rating) : null,
        reviewCount: r.review_count, reviews: r.review_count || 0,
        pricePerNight: parseFloat(r.price_per_night), price: parseFloat(r.price_per_night),
        currency: r.currency || 'BDT',
        images: safeJsonParse(r.images, []), amenities: safeJsonParse(r.amenities, []),
        description: r.description, latitude: r.latitude, longitude: r.longitude,
        source: 'db',
        rooms: [],
      }
    });
  } catch (err) {
    console.error('Hotel detail error:', err);
    res.status(500).json({ message: 'Something went wrong', status: 500 });
  }
});

// POST /hotels/book — Multi-provider booking
router.post('/book', authenticate, async (req, res) => {
  try {
    const { hotelId, hotelCode, checkIn, checkOut, rooms, guests, contactInfo, paymentMethod, paymentInfo, source, rateKey, bookingKey, totalAmount: reqTotal, hotelName } = req.body;
    const bookingId = uuidv4();
    const bookingRef = `HT${String(Date.now()).slice(-8)}`;

    let sabrePnr = null;
    let sabreConfirmation = null;

    // If Sabre hotel, attempt GDS booking
    if (source === 'sabre' && (hotelCode || hotelId)) {
      try {
        const resolvedCode = (hotelCode || hotelId || '').replace('sabre-', '');
        const sabreResult = await sabreBook({
          hotelCode: resolvedCode,
          rateKey,
          bookingKey,
          checkIn,
          checkOut,
          rooms: rooms || [{ adults: 2 }],
          guests: guests || [],
          contactInfo: contactInfo || {},
          paymentInfo: paymentInfo || null,
        });
        sabrePnr = sabreResult.pnr;
        sabreConfirmation = sabreResult.confirmationNumber;
      } catch (err) {
        console.error('[Hotels] Sabre booking failed:', err.message);
      }
    }

    // Calculate amount
    let totalAmount = parseFloat(reqTotal) || 0;
    const resolvedHotelId = hotelId || hotelCode;

    if (totalAmount === 0 && resolvedHotelId && !String(resolvedHotelId).startsWith('sabre-')) {
      const [hotels] = await db.query('SELECT * FROM hotels WHERE id = ?', [resolvedHotelId]);
      const nights = checkIn && checkOut ? Math.max(1, Math.ceil((new Date(checkOut) - new Date(checkIn)) / 86400000)) : 1;
      totalAmount = hotels.length > 0 ? parseFloat(hotels[0].price_per_night) * nights * (parseInt(req.body.roomCount) || 1) : 0;
    }

    const details = {
      hotel: hotelName || 'Hotel',
      checkIn, checkOut,
      rooms: req.body.roomCount || 1,
      source: source || 'db',
      sabrePnr,
      sabreConfirmation,
      hotelCode: hotelCode || hotelId,
      rateKey,
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
      totalAmount, currency: 'USD', bookingType: 'hotel',
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
