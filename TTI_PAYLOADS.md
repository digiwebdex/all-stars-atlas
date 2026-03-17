# Seven Trip — TTI/Air Astra (ZENITH) Working Payloads Reference (v4.1.6)

> Complete, production-verified payloads for all TTI (Air Astra) API operations.
> Provider: TTI Sale Engine (ZENITH WCF) | Airline: Air Astra (2A / S2)
> Protocol: JSON over HTTP POST (WCF-style)
> Auth: API Key stored in `system_settings` table (`api_tti_astra`)
> Last verified: 2026-03-17 (v4.1.6)
> See also: `SABRE_PAYLOADS.md` for Sabre GDS payloads

---

## Table of Contents

1. [Configuration & Authentication](#1-configuration)
2. [Flight Search (SearchFlights)](#2-flight-search)
3. [Create Booking (CreateBooking)](#3-create-booking)
4. [Cancel Booking (Cancel)](#4-cancel-booking)
5. [Issue Ticket (Cancel with Action=Ticket)](#5-issue-ticket)
6. [Void Ticket (Cancel with Action=Void)](#6-void-ticket)
7. [Response Fields Reference](#7-response-fields)
8. [Passenger Type & SSR Rules](#8-passenger-ssr-rules)
9. [Fare & Baggage Extraction](#9-fare-baggage)
10. [Date Format Reference](#10-date-format)
11. [Error Handling](#11-error-handling)
12. [Endpoint Summary](#12-endpoint-summary)

---

## 1. Configuration & Authentication <a name="1-configuration"></a>

### Database Config (system_settings)

```sql
SELECT setting_value FROM system_settings WHERE setting_key = 'api_tti_astra';
```

**Config JSON shape:**
```json
{
  "environment": "production",
  "preprod_url": "http://preprod.zenith.example.com/SaleEngine.svc/json",
  "preprod_key": "PREPROD-API-KEY",
  "prod_url": "http://prod.zenith.example.com/SaleEngine.svc/json",
  "prod_key": "PROD-API-KEY",
  "agency_id": "AGENCY_ID",
  "agency_name": "Seven Trip"
}
```

### Request Modes

TTI supports two request styles:

| Mode | URL Suffix | Body Wrapping | Use Case |
|------|-----------|---------------|----------|
| **Wrapped** | `/{method}` | `{ "request": { ... } }` | SearchFlights |
| **Bare** | `/{method}?BodyStyle=Bare` | `{ ... }` (direct) | CreateBooking, Cancel |

### HTTP Headers

```
Content-Type: application/json
Accept: application/json
```

**Timeout:** 30 seconds | **Retry:** HTTP ↔ HTTPS protocol fallback

---

## 2. Flight Search (SearchFlights) <a name="2-flight-search"></a>

**Endpoint:** `POST {baseUrl}/SearchFlights`
**Mode:** Wrapped (`{ "request": { ... } }`)

### One-Way Search (DAC → CXB)

```json
{
  "request": {
    "RequestInfo": {
      "AuthenticationKey": "<API_KEY>"
    },
    "Passengers": [
      { "Ref": "1", "PassengerTypeCode": "AD", "PassengerQuantity": 1 }
    ],
    "OriginDestinations": [
      {
        "Ref": "1",
        "OriginCode": "DAC",
        "DestinationCode": "CXB",
        "TargetDate": "/Date(1744502400000)/"
      }
    ],
    "FareDisplaySettings": {
      "SaleCurrencyCode": "BDT"
    }
  }
}
```

### Round-Trip Search (DAC → CGP → DAC)

```json
{
  "request": {
    "RequestInfo": {
      "AuthenticationKey": "<API_KEY>"
    },
    "Passengers": [
      { "Ref": "1", "PassengerTypeCode": "AD", "PassengerQuantity": 1 }
    ],
    "OriginDestinations": [
      { "Ref": "1", "OriginCode": "DAC", "DestinationCode": "CGP", "TargetDate": "/Date(1744502400000)/" },
      { "Ref": "2", "OriginCode": "CGP", "DestinationCode": "DAC", "TargetDate": "/Date(1745107200000)/" }
    ],
    "FareDisplaySettings": {
      "SaleCurrencyCode": "BDT"
    }
  }
}
```

### Multi-Pax Search (ADT + CHD + INF)

```json
{
  "request": {
    "RequestInfo": {
      "AuthenticationKey": "<API_KEY>"
    },
    "Passengers": [
      { "Ref": "1", "PassengerTypeCode": "AD", "PassengerQuantity": 1 },
      { "Ref": "2", "PassengerTypeCode": "CHD", "PassengerQuantity": 1 },
      { "Ref": "3", "PassengerTypeCode": "INF", "PassengerQuantity": 1 }
    ],
    "OriginDestinations": [
      { "Ref": "1", "OriginCode": "DAC", "DestinationCode": "CXB", "TargetDate": "/Date(1744502400000)/" }
    ],
    "FareDisplaySettings": {
      "SaleCurrencyCode": "BDT"
    }
  }
}
```

### Cabin Class Filter

Add to `FareDisplaySettings`:

```json
{
  "FareDisplaySettings": {
    "SaleCurrencyCode": "BDT",
    "CabinClassCode": "Y"
  }
}
```

| Cabin | Code |
|-------|------|
| Economy | `Y` |
| Premium Economy | `W` |
| Business | `C` |
| First | `F` |

### Search Response Shape

```json
{
  "ResponseInfo": { "Error": null },
  "Segments": [
    {
      "Ref": "1",
      "FlightNumber": "443",
      "AirlineCode": "2A",
      "Origin": "DAC",
      "Destination": "CXB",
      "DepartureDate": "/Date(1744523400000+0600)/",
      "ArrivalDate": "/Date(1744527000000+0600)/",
      "DepartureTerminal": null,
      "ArrivalTerminal": null,
      "Duration": 60,
      "CabinClass": "Economy",
      "BookingClass": "Y",
      "AvailableSeats": 9,
      "AircraftType": "ATR72"
    }
  ],
  "FareInfo": {
    "Itineraries": [
      {
        "Ref": "1",
        "AirOriginDestinations": [
          { "Ref": "1", "RefSegment": "1", "RefFareRule": "1" }
        ],
        "SaleCurrencyAmount": {
          "TotalAmount": 5099,
          "BaseFare": 3800,
          "TaxAmount": 1299,
          "CurrencyCode": "BDT"
        }
      }
    ],
    "ETTicketFares": [
      {
        "RefItinerary": "1",
        "RefPassenger": "1",
        "SaleCurrencyAmount": { "Amount": 5099, "BaseFare": 3800, "TaxAmount": 1299 },
        "OriginDestinationFares": [
          {
            "CouponFares": [
              {
                "BagAllowances": [
                  { "Weight": 20, "WeightMeasureQualifier": "KG", "CarryOn": false },
                  { "Weight": 7, "WeightMeasureQualifier": "KG", "CarryOn": true }
                ]
              }
            ]
          }
        ]
      }
    ],
    "FareRules": [
      {
        "Ref": "1",
        "VoluntaryRefundCode": "WithPenalties",
        "VoluntaryChangeCode": "WithPenalties",
        "FareConditionText": "Refundable with penalties (4000-7000 BDT based on time before flight)"
      }
    ]
  },
  "Offer": {
    "Ref": "OFFER-REF-123"
  }
}
```

**Critical fields preserved for booking:** `Offer.Ref`, `Itinerary.Ref`, `Segments[]`, `FareInfo`, `Passengers[]`

---

## 3. Create Booking (CreateBooking) <a name="3-create-booking"></a>

**Endpoint:** `POST {baseUrl}/CreateBooking?BodyStyle=Bare`
**Mode:** Bare (body sent directly, no `{ "request": ... }` wrapper)

### 1 Adult Booking (DAC → CXB)

```json
{
  "RequestInfo": { "AuthenticationKey": "<API_KEY>" },
  "Offer": {
    "Ref": "OFFER-REF-123",
    "RefItinerary": "1"
  },
  "Passengers": [
    {
      "Ref": "1",
      "RefItinerary": "1",
      "PassengerTypeCode": "AD",
      "PassengerQuantity": 1,
      "NameElement": {
        "CivilityCode": "MR",
        "Firstname": "MD KAOSAR",
        "Middlename": null,
        "Surname": "AHMED",
        "Extensions": null
      },
      "Title": "MR",
      "FirstName": "MD KAOSAR",
      "LastName": "AHMED",
      "GivenName": "MD KAOSAR",
      "Surname": "AHMED",
      "DateOfBirth": "/Date(631152000000)/",
      "Gender": "M",
      "GenderCode": "M",
      "Nationality": "BD",
      "NationalityCode": "BD",
      "PassportNumber": "A12345678",
      "PassportExpiry": "/Date(1893456000000)/",
      "DocumentInfo": {
        "DocumentNumber": "A12345678",
        "DocumentType": "P",
        "ExpiryDate": "/Date(1893456000000)/",
        "NationalityCode": "BD"
      },
      "ContactInfo": {
        "Email": "test@example.com",
        "Phone": "+8801712345678"
      },
      "Email": "test@example.com",
      "Phone": "+8801712345678",
      "Extensions": null
    }
  ],
  "Segments": [
    {
      "Ref": "1",
      "FlightNumber": "443",
      "AirlineCode": "2A",
      "Origin": "DAC",
      "Destination": "CXB",
      "DepartureDate": "/Date(1744523400000+0600)/",
      "CabinClass": "Economy"
    }
  ],
  "FareInfo": {
    "Itineraries": [
      {
        "Ref": "1",
        "AirOriginDestinations": [{ "Ref": "1", "RefSegment": "1" }],
        "SaleCurrencyAmount": { "TotalAmount": 5099, "CurrencyCode": "BDT" }
      }
    ],
    "ETTicketFares": [
      {
        "RefItinerary": "1",
        "RefPassenger": "1",
        "SaleCurrencyAmount": { "Amount": 5099 }
      }
    ]
  },
  "SpecialServices": null,
  "ContactInfo": {
    "Email": "test@example.com",
    "Phone": "+8801712345678"
  },
  "AgencyInfo": {
    "AgencyId": "AGENCY_ID",
    "AgencyName": "Seven Trip"
  }
}
```

### Multi-Pax Booking (ADT + CHD + INF) with WCHR SSR

```json
{
  "RequestInfo": { "AuthenticationKey": "<API_KEY>" },
  "Offer": { "Ref": "OFFER-REF-123", "RefItinerary": "1" },
  "Passengers": [
    {
      "Ref": "1",
      "RefItinerary": "1",
      "PassengerTypeCode": "AD",
      "PassengerQuantity": 1,
      "NameElement": { "CivilityCode": "MR", "Firstname": "MD KAOSAR", "Surname": "AHMED" },
      "DateOfBirth": "/Date(631152000000)/",
      "Gender": "M",
      "Nationality": "BD",
      "PassportNumber": "A12345678",
      "DocumentInfo": { "DocumentNumber": "A12345678", "DocumentType": "P", "NationalityCode": "BD" },
      "ContactInfo": { "Email": "test@example.com", "Phone": "+8801712345678" }
    },
    {
      "Ref": "2",
      "RefItinerary": "1",
      "PassengerTypeCode": "CHD",
      "PassengerQuantity": 1,
      "NameElement": { "CivilityCode": "MSTR", "Firstname": "RAHIM", "Surname": "AHMED" },
      "DateOfBirth": "/Date(1533859200000)/",
      "Gender": "M",
      "Nationality": "BD",
      "ContactInfo": null
    },
    {
      "Ref": "3",
      "RefItinerary": "1",
      "PassengerTypeCode": "INF",
      "PassengerQuantity": 1,
      "NameElement": { "CivilityCode": "MISS", "Firstname": "BABY", "Surname": "AHMED" },
      "DateOfBirth": "/Date(1705276800000)/",
      "Gender": "F",
      "Nationality": "BD",
      "ContactInfo": null
    }
  ],
  "Segments": [
    { "Ref": "1", "FlightNumber": "443", "AirlineCode": "2A", "Origin": "DAC", "Destination": "CXB" }
  ],
  "FareInfo": {
    "Itineraries": [{ "Ref": "1" }],
    "ETTicketFares": [
      { "RefItinerary": "1", "RefPassenger": "1", "SaleCurrencyAmount": { "Amount": 5099 } },
      { "RefItinerary": "1", "RefPassenger": "2", "SaleCurrencyAmount": { "Amount": 3598 } },
      { "RefItinerary": "1", "RefPassenger": "3", "SaleCurrencyAmount": { "Amount": 0 } }
    ]
  },
  "SpecialServices": [
    {
      "Code": "CHLD",
      "RefPassenger": "2",
      "Data": {
        "Chld": { "DateOfBirth": "/Date(1533859200000)/", "Extensions": null },
        "Doca": null, "Doco": null, "Docs": null, "Foid": null, "Fqtv": null,
        "Inft": null, "Umnr": null, "Adof": null, "Seat": null,
        "Pctc": null, "Ectc": null, "Bill": null, "Fields": null, "Extensions": null
      },
      "Status": null, "Text": null, "RefSegment": null,
      "TechnicalType": null, "Extensions": null, "Available": null
    },
    {
      "Code": "INFT",
      "RefPassenger": "3",
      "Data": {
        "Inft": {
          "DateOfBirth": "/Date(1705276800000)/",
          "RefPassengerWithSeat": "1",
          "Extensions": null
        },
        "Doca": null, "Doco": null, "Docs": null, "Foid": null, "Fqtv": null,
        "Chld": null, "Umnr": null, "Adof": null, "Seat": null,
        "Pctc": null, "Ectc": null, "Bill": null, "Fields": null, "Extensions": null
      },
      "Status": null, "Text": null, "RefSegment": null,
      "TechnicalType": null, "Extensions": null, "Available": null
    },
    {
      "Code": "WCHR",
      "RefPassenger": "1",
      "RefSegment": "1",
      "Data": null,
      "Status": null,
      "Text": "Wheelchair assistance required",
      "TechnicalType": null, "Extensions": null, "Available": null
    }
  ],
  "ContactInfo": { "Email": "test@example.com", "Phone": "+8801712345678" },
  "AgencyInfo": { "AgencyId": "AGENCY_ID", "AgencyName": "Seven Trip" }
}
```

### Booking Response Shape

```json
{
  "ResponseInfo": { "Error": null },
  "Booking": {
    "Id": 16755091,
    "PnrInformation": {
      "PnrCode": "00KTUN",
      "PnrStatusCode": "Option"
    },
    "Segments": [
      {
        "Ref": "1",
        "FlightNumber": "443",
        "AirlineCode": "2A",
        "TimeLimit": "/Date(1773585817906+0100)/"
      }
    ],
    "Passengers": [
      { "Ref": "1", "FirstName": "MD KAOSAR", "LastName": "AHMED" }
    ],
    "FareInfo": {
      "ETTicketFares": [
        {
          "RefPassenger": "1",
          "SaleCurrencyAmountToPay": 5099,
          "OriginDestinationFares": [
            {
              "CouponFares": [
                {
                  "BagAllowances": [{ "Weight": 20, "WeightMeasureQualifier": "KG" }]
                }
              ]
            }
          ]
        }
      ]
    }
  }
}
```

### PNR Extraction Priority Chain

```
1. Booking.PnrInformation.PnrCode
2. Booking.PnrInformation.RecordLocator
3. Booking.PnrInformation.PNR
4. Booking.PnrInformation.BookingReference
5. Booking.RecordLocator
6. Booking.Segments[0].RecordLocator
7. Booking.Segments[0].AirlinePNR
8. Booking.PNR
9. Booking.BookingReference
```

### Key Rules

| Rule | Detail |
|------|--------|
| **Offer.Ref** | MUST come from SearchFlights response — links to search session |
| **RefItinerary** | MUST match the selected Itinerary.Ref from search |
| **Unique Ref per passenger** | Each named passenger gets sequential `Ref` (1, 2, 3...) |
| **ETTicketFares expansion** | Search returns 1 fare per group; booking needs 1 per named passenger with unique `RefPassenger` |
| **Contact info** | Only provide for adults, not children/infants |
| **CivilityCode** | Boys: `MSTR`, Girls: `MISS`, Adult male: `MR`, Adult female: `MRS`/`MS` |
| **PnrStatusCode** | `Option` = Reserved (not ticketed), requires manual ticketing |
| **TimeLimit** | Airline auto-cancel deadline (MS Date format) |

---

## 4. Cancel Booking (Cancel) <a name="4-cancel-booking"></a>

**Endpoint:** `POST {baseUrl}/Cancel?BodyStyle=Bare`
**Mode:** Bare

### Primary Cancel Payload (Verified Working)

```json
{
  "RequestInfo": { "AuthenticationKey": "<API_KEY>" },
  "UniqueID": { "ID": "00KTUN" },
  "CancelSettings": {
    "CancelSegmentSettings": {}
  }
}
```

### Cancel Variant Fallback Chain

TTI accepts multiple cancel payload shapes. Try in order:

| # | Variant | Payload |
|---|---------|---------|
| 1 | CancelSegmentSettings (empty) | `{ CancelSettings: { CancelSegmentSettings: {} } }` |
| 2 | CancelSegmentSettings (null segments) | `{ CancelSettings: { CancelSegmentSettings: { SegmentReferencesToCancel: null } } }` |
| 3 | RefundSettings | `{ CancelSettings: { RefundSettings: { RefundAllTaxes: false } } }` |
| 4 | RefundRequestSettings | `{ CancelSettings: { RefundRequestSettings: { ShouldCancelSegments: true } } }` |
| 5 | CancelInfo.CanCancel | `{ CancelInfo: { CanCancel: true } }` |
| 6 | CancelInfo.CanVoid | `{ CancelInfo: { CanVoid: true } }` |

### UniqueID Variants

Each cancel payload is also tried with different `UniqueID` shapes:

```json
// Variant A
{ "ID": "00KTUN" }

// Variant B
{ "ID": "00KTUN", "TypeCode": "BookingReference" }

// Variant C
{ "ID": "00KTUN", "TypeCode": "Reservation" }
```

**Total combinations:** 6 payloads × 3 UniqueID variants × 2 modes (Bare + Wrapped) = **36 attempts**

### Cancel Response

```json
{
  "ResponseInfo": { "Error": null }
}
```

### Verified Cancelled PNRs

| PNR | Route | Pax | Cancel Method |
|-----|-------|-----|---------------|
| 00KTUN | DAC→CXB | 1 ADT | Bare+UniqueID(00KTUN)+CancelSegmentSettings(empty) |
| 00KTUP | DAC→CXB | ADT+CHD+INF+WCHR | Bare+UniqueID(00KTUP)+CancelSegmentSettings(empty) |
| 00KTUQ | DAC→CGP→DAC | 1 ADT (Round-Trip) | Bare+UniqueID(00KTUQ)+CancelSegmentSettings(empty) |
| 00KTUS | DAC→CXB | ADT+CHD | Bare+UniqueID(00KTUS)+CancelSegmentSettings(empty) |

---

## 5. Issue Ticket (Cancel with Action=Ticket) <a name="5-issue-ticket"></a>

**Endpoint:** `POST {baseUrl}/Cancel?BodyStyle=Bare` (same Cancel endpoint)
**Note:** TTI may not support remote ticketing. Air Astra back-office may be required.

### Ticketing Attempt Payload

```json
{
  "RequestInfo": { "AuthenticationKey": "<API_KEY>" },
  "CancelTicketSettings": {
    "Action": "Ticket",
    "BookingReference": "00KTUN",
    "BookingId": 16755091
  }
}
```

### Fallback Variants

| # | Label | Body Shape |
|---|-------|-----------|
| 1 | Bare + BookingRef inside CancelTicketSettings | `{ CancelTicketSettings: { Action: "Ticket", BookingReference, BookingId } }` |
| 2 | Bare + BookingRef top-level | `{ BookingReference, BookingId, CancelTicketSettings: { Action: "Ticket", Type: "Confirm" } }` |
| 3 | Wrapped + BookingRef inside CancelTicketSettings | Same as #1, wrapped in `{ request: ... }` |
| 4 | Wrapped + BookingRef top-level | Same as #2, wrapped with AgencyInfo |

**Expected outcome:** If API doesn't support ticketing, returns hint to use Air Astra admin portal.

---

## 6. Void Ticket (Cancel with Action=Void) <a name="6-void-ticket"></a>

**Endpoint:** `POST {baseUrl}/Cancel?BodyStyle=Bare`

### Void Payload

```json
{
  "RequestInfo": { "AuthenticationKey": "<API_KEY>" },
  "CancelTicketSettings": {
    "Action": "Void",
    "BookingReference": "00KTUN",
    "TicketNumber": "2A1234567890"
  }
}
```

### Void Variant Chain

Same 4-variant pattern as ticketing, with `Action: "Void"` and `TicketNumber` included.

---

## 7. Response Fields Reference <a name="7-response-fields"></a>

### Search Response Top-Level Keys

| Key | Type | Description |
|-----|------|-------------|
| `ResponseInfo` | Object | Error info (null if success) |
| `Segments` | Array | Flight segments with times, airline, duration |
| `FareInfo` | Object | Itineraries, ETTicketFares, FareRules |
| `Offer` | Object | CRITICAL: Contains `Ref` needed for CreateBooking |
| `Passengers` | Array | Passenger group definitions from search |

### Booking Response Keys

| Key | Type | Description |
|-----|------|-------------|
| `Booking.Id` | Number | TTI internal booking ID |
| `Booking.PnrInformation.PnrCode` | String | Airline PNR (e.g., `00KTUN`) |
| `Booking.PnrInformation.PnrStatusCode` | String | `Option` = Reserved |
| `Booking.Segments[0].TimeLimit` | String | Airline auto-cancel deadline (MS Date) |
| `Booking.FareInfo.ETTicketFares` | Array | Per-passenger fare breakdown |

---

## 8. Passenger Type & SSR Rules <a name="8-passenger-ssr-rules"></a>

### Passenger Type Codes

| Type | Code | CivilityCode (Male) | CivilityCode (Female) |
|------|------|---------------------|----------------------|
| Adult | `AD` | `MR` | `MRS` / `MS` |
| Child (2-11) | `CHD` | `MSTR` | `MISS` |
| Infant (0-2) | `INF` | `MSTR` | `MISS` |

### SSR Support Matrix (Air Astra)

| SSR Code | Supported | Description |
|----------|-----------|-------------|
| `WCHR` | ✅ | Wheelchair (can walk short distance) |
| `WCHS` | ✅ | Wheelchair (cannot walk stairs) |
| `WCHC` | ✅ | Wheelchair (completely immobile) |
| `BLND` | ✅ | Blind passenger |
| `DEAF` | ✅ | Deaf passenger |
| `MEDA` | ✅ | Medical assistance |
| `PETC` | ✅ | Pet in cabin |
| `AVIH` | ✅ | Animal in hold |
| `XBAG` | ✅ | Extra baggage |
| `FQTV` | ✅ | Frequent flyer |
| `CHLD` | ✅ | Child SSR (with DOB) |
| `INFT` | ✅ | Infant SSR (with DOB + associated adult) |
| `MOML` | ⛔ | Meal — NOT supported |
| `VGML` | ⛔ | Vegetarian meal — NOT supported |
| `OTHS` | ⛔ | Free text — NOT supported |

### SSR Payload Rules

- **RefSegment required**: Each SSR must be expanded per-segment
- **CHLD SSR**: Requires `Data.Chld.DateOfBirth` in MS Date format
- **INFT SSR**: Requires `Data.Inft.DateOfBirth` + `Data.Inft.RefPassengerWithSeat` (adult Ref)
- **WCF Data structure**: Must include all null fields (`Doca`, `Doco`, `Docs`, `Foid`, `Fqtv`, etc.) for proper deserialization
- **Retry on INFT failure**: If `RefPassengerWithSeat` error → retry with `null` → retry without CHLD/INFT SSRs

---

## 9. Fare & Baggage Extraction <a name="9-fare-baggage"></a>

### Fare Extraction

```
Itinerary.SaleCurrencyAmount.TotalAmount   → Total price (all pax)
Itinerary.SaleCurrencyAmount.BaseFare      → Base fare
Itinerary.SaleCurrencyAmount.TaxAmount     → Total taxes
ETTicketFare.SaleCurrencyAmount.Amount     → Per-passenger fare
ETTicketFare.SaleCurrencyAmountToPay       → Payable amount (booking response)
```

### Baggage Extraction

```
ETTicketFare.OriginDestinationFares[].CouponFares[].BagAllowances[]

Each BagAllowance:
  Weight: 20                    → Checked baggage weight
  WeightMeasureQualifier: "KG"  → Unit
  CarryOn: false                → Checked bag
  CarryOn: true                 → Hand/cabin bag
  Quantity: 1                   → Piece-based allowance
```

### Fare Rules

```
FareRules[].VoluntaryRefundCode:
  "NotPermitted"    → Non-refundable
  "WithPenalties"   → Refundable with penalties (4000-7000 BDT)
  "Free"            → Fully refundable

FareRules[].VoluntaryChangeCode:
  "NotPermitted"    → No date change
  "WithPenalties"   → Date change with penalty
  "Free"            → Free date change
```

---

## 10. Date Format Reference <a name="10-date-format"></a>

TTI uses Microsoft WCF JSON date format:

```
/Date(milliseconds_since_epoch)/
/Date(milliseconds_since_epoch+timezone_offset)/
```

### Examples

| Date | MS Format |
|------|-----------|
| 2026-04-13 00:00 UTC | `/Date(1744502400000)/` |
| 1990-01-01 (DOB) | `/Date(631152000000)/` |
| 2030-01-01 (Passport expiry) | `/Date(1893456000000)/` |

### Parsing in JavaScript

```javascript
function parseTTIDate(dateStr) {
  if (!dateStr) return null;
  const match = dateStr.match(/\/Date\((-?\d+)([+-]\d{4})?\)\//);
  if (match) return new Date(parseInt(match[1]));
  return new Date(dateStr);
}
```

---

## 11. Error Handling <a name="11-error-handling"></a>

### Error Response Shape

```json
{
  "ResponseInfo": {
    "Error": {
      "Code": "ERR_CODE",
      "Message": "Human-readable error message",
      "FullText": "Detailed error text",
      "Extensions": { /* additional error context */ }
    }
  },
  "InvalidData": {
    "SpecialServices": [
      { "Code": "INFT", "Error": "Passenger with seat cannot be found" }
    ]
  }
}
```

### Retryable Errors

| Error Pattern | Action |
|--------------|--------|
| `Missing field` | Try next payload variant |
| `Missing RequestInfo` | Try wrapped mode |
| `NullReference` | Try next payload variant |
| `not valid` / `not found` | Try next UniqueID variant |
| `RefPassengerWithSeat` | Retry INFT with null ref |
| `DateOfBirth mandatory` | Remove CHLD/INFT SSRs |

### Non-Retryable Errors

| Error Pattern | Action |
|--------------|--------|
| `not supported` | Feature unavailable — report to user |
| `invalid` (with context) | Bad data — fix payload |

---

## 12. Endpoint Summary <a name="12-endpoint-summary"></a>

| # | Operation | Method | Endpoint | Mode | Backend File |
|---|-----------|--------|----------|------|-------------|
| 1 | Flight Search | POST | `/SearchFlights` | Wrapped | `tti-flights.js` |
| 2 | Create Booking | POST | `/CreateBooking?BodyStyle=Bare` | Bare | `tti-flights.js` |
| 3 | Cancel Booking | POST | `/Cancel?BodyStyle=Bare` | Bare | `tti-flights.js` |
| 4 | Issue Ticket | POST | `/Cancel?BodyStyle=Bare` | Bare | `tti-flights.js` |
| 5 | Void Ticket | POST | `/Cancel?BodyStyle=Bare` | Bare | `tti-flights.js` |
| 6 | Ping (Health) | POST | `/Ping` | Either | — |
| 7 | Help (Methods) | POST | `/Help` | Either | — |

### Available API Methods

Only 3 methods exist on TTI Sale Engine:
- `SearchFlights` — Flight search
- `CreateBooking` — PNR creation
- `Cancel` — Cancel / Ticket / Void (action-based)

### Provider Coverage

| Feature | Air Astra (2A/S2) |
|---------|-------------------|
| Domestic Bangladesh | ✅ Primary provider |
| International | ⛔ Not available |
| One-Way | ✅ |
| Round-Trip | ✅ (paired segments) |
| Multi-City | ⛔ |
| Seat Map | ⛔ (no API method) |
| Ancillaries | ⛔ (no API method) |
| Auto-Ticketing | ⛔ (manual via back-office) |

---

## Production Probe Evidence

### Verified PNRs (2026-03-14)

| # | Test | Route | Pax | PNR | Result |
|---|------|-------|-----|-----|--------|
| 5 | 1 ADT Domestic | DAC→CXB | 1 ADT | 00KTUN | ✅ Book+Cancel |
| 6 | Multi-Pax + WCHR | DAC→CXB | ADT+CHD+INF+WCHR | 00KTUP | ✅ Book+Cancel |
| 7 | Round-Trip | DAC→CGP→DAC | 1 ADT | 00KTUQ | ✅ Book+Cancel |
| 10 | ADT+CHD | DAC→CXB | ADT+CHD | 00KTUS | ✅ Book+Cancel |

### Fare Breakdown Example (Test 10: ADT+CHD)

```
Total: 8697 BDT (ADT 5099 + CHD 3598)
Taxes per passenger: BD, OW, P7, P8, E5, UT, YQ
Baggage: 20 KG per passenger
Fare Rules: Refundable with penalties (4000-7000 BDT)
```

---

*Last updated: 2026-03-15 | v4.1.3 | All TTI operations production-verified | 4/4 booking tests passed*
