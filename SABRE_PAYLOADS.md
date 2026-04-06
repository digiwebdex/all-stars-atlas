# Seven Trip — Sabre GDS Working Payloads Reference (v4.2.0)

> Complete, production-verified payloads for all Sabre API operations.
> PCC: J4YL | EPR: 631470 | Environment: Production
> REST: `https://api.platform.sabre.com` | SOAP: `https://webservices.platform.sabre.com`
> Last verified: 2026-04-06 (v4.2.0 — GDS Terminal upgraded to SabreCommandLLSRQ v2.0.0+)
> Sections 17–26 implemented in v4.0.0 — see SABRE_FEATURE_AUDIT.md for payload samples
> v4.1.0: Children use age-based PTC C05–C11, Infants use Infant.Ind=true with DateOfBirth
> v4.1.5: Card cabin labels derived from booking class (J→Business, V→Economy); fare options sorted by searched cabin
> v4.1.6: `sabreRequest()` handles empty/non-JSON responses; Flight Status & Fare Rules modals resilient
> v4.2.0: Admin GDS Terminal uses `SabreCommandLLSRQ` v2.0.0+ (upgraded from deprecated v1.8.1)

---

## Table of Contents

1. [Authentication (OAuth v3 Password Grant)](#1-authentication)
2. [Flight Search (BFM v5)](#2-flight-search)
3. [Price Revalidation (v4)](#3-price-revalidation)
4. [Create Booking / PNR (v2.4.0)](#4-create-booking)
5. [Retrieve Booking (GetBooking v1)](#5-retrieve-booking)
6. [Check Ticket Status (v1)](#6-check-ticket-status)
7. [Issue Ticket (AirTicketRQ v1.3.0)](#7-issue-ticket)
8. [Cancel Booking](#8-cancel-booking)
9. [Seat Map (REST + SOAP Fallback)](#9-seat-map)
10. [Assign Seats (v2.4.0 Update)](#10-assign-seats)
11. [Add Ancillary SSR (v2.4.0 Update)](#11-add-ancillary-ssr)
12. [PNR Extraction Logic](#12-pnr-extraction)
13. [Airline PNR Deep Scan](#13-airline-pnr-extraction)
14. [SSR Reference Table](#14-ssr-reference)
15. [Passenger Name & Title Rules](#15-name-title-rules)
16. [DOCS (Passport) Payload Rules](#16-docs-rules)

---

## 1. Authentication (OAuth v3 Password Grant) <a name="1-authentication"></a>

**Endpoint:** `POST /v3/auth/token`

```
URL: https://api.platform.sabre.com/v3/auth/token
Method: POST
Content-Type: application/x-www-form-urlencoded
Authorization: Basic <base64(clientId:clientSecret)>
```

**Request Body (URL-encoded):**
```
grant_type=password&username=631470-J4YL-AA&password=<agencyPassword>
```

**Username format:** `{EPR}-{PCC}-AA`

**Response:**
```json
{
  "access_token": "T1RLAQKx...",
  "token_type": "bearer",
  "expires_in": 604800
}
```

**Notes:**
- Token valid for ~7 days (604800 seconds)
- Pre-computed `Basic` auth from Sabre JV_BD docs preferred over computing from clientId:clientSecret
- CERT and PROD have different clientId/clientSecret pairs

---

## 2. Flight Search — Bargain Finder Max v5 <a name="2-flight-search"></a>

**Endpoint:** `POST /v5/offers/shop`

### 2a. One-Way Search

```json
{
  "OTA_AirLowFareSearchRQ": {
    "Version": "5",
    "POS": {
      "Source": [{
        "PseudoCityCode": "J4YL",
        "RequestorID": { "Type": "1", "ID": "1", "CompanyName": { "Code": "TN" } }
      }]
    },
    "OriginDestinationInformation": [{
      "RPH": "1",
      "DepartureDateTime": "2026-04-27T00:00:00",
      "OriginLocation": { "LocationCode": "DAC" },
      "DestinationLocation": { "LocationCode": "DXB" }
    }],
    "TravelPreferences": {
      "TPA_Extensions": {
        "NumTrips": { "Number": 200 },
        "DataSources": {
          "NDC": "Enable",
          "ATPCO": "Enable",
          "LCC": "Enable"
        },
        "DiversityParameters": {
          "Weightings": {
            "PriceWeight": 8,
            "TravelTimeWeight": 2
          }
        }
      },
      "CabinPref": [{ "Cabin": "Y", "PreferLevel": "Preferred" }]
    },
    "TPA_Extensions": {
      "IntelliSellTransaction": {
        "RequestType": { "Name": "200ITINS" }
      }
    },
    "TravelerInfoSummary": {
      "AirTravelerAvail": [{
        "PassengerTypeQuantity": [
          { "Code": "ADT", "Quantity": 1 }
        ]
      }]
    }
  }
}
```

### 2b. Round-Trip Search

```json
{
  "OTA_AirLowFareSearchRQ": {
    "Version": "5",
    "POS": {
      "Source": [{
        "PseudoCityCode": "J4YL",
        "RequestorID": { "Type": "1", "ID": "1", "CompanyName": { "Code": "TN" } }
      }]
    },
    "OriginDestinationInformation": [
      {
        "RPH": "1",
        "DepartureDateTime": "2026-04-27T00:00:00",
        "OriginLocation": { "LocationCode": "DAC" },
        "DestinationLocation": { "LocationCode": "DXB" }
      },
      {
        "RPH": "2",
        "DepartureDateTime": "2026-05-05T00:00:00",
        "OriginLocation": { "LocationCode": "DXB" },
        "DestinationLocation": { "LocationCode": "DAC" }
      }
    ],
    "TravelPreferences": {
      "TPA_Extensions": {
        "NumTrips": { "Number": 200 },
        "DataSources": { "NDC": "Enable", "ATPCO": "Enable", "LCC": "Enable" },
        "DiversityParameters": { "Weightings": { "PriceWeight": 8, "TravelTimeWeight": 2 } }
      },
      "CabinPref": [{ "Cabin": "Y", "PreferLevel": "Preferred" }]
    },
    "TPA_Extensions": {
      "IntelliSellTransaction": { "RequestType": { "Name": "200ITINS" } }
    },
    "TravelerInfoSummary": {
      "AirTravelerAvail": [{
        "PassengerTypeQuantity": [
          { "Code": "ADT", "Quantity": 1 },
          { "Code": "CNN", "Quantity": 1 },
          { "Code": "INF", "Quantity": 1 }
        ]
      }]
    }
  }
}
```

### 2c. Multi-City Search

```json
{
  "OTA_AirLowFareSearchRQ": {
    "Version": "5",
    "POS": {
      "Source": [{
        "PseudoCityCode": "J4YL",
        "RequestorID": { "Type": "1", "ID": "1", "CompanyName": { "Code": "TN" } }
      }]
    },
    "OriginDestinationInformation": [
      { "RPH": "1", "DepartureDateTime": "2026-04-27T00:00:00", "OriginLocation": { "LocationCode": "DAC" }, "DestinationLocation": { "LocationCode": "DXB" } },
      { "RPH": "2", "DepartureDateTime": "2026-04-30T00:00:00", "OriginLocation": { "LocationCode": "DXB" }, "DestinationLocation": { "LocationCode": "LHR" } },
      { "RPH": "3", "DepartureDateTime": "2026-05-05T00:00:00", "OriginLocation": { "LocationCode": "LHR" }, "DestinationLocation": { "LocationCode": "DAC" } }
    ],
    "TravelPreferences": {
      "TPA_Extensions": {
        "NumTrips": { "Number": 200 },
        "DataSources": { "NDC": "Enable", "ATPCO": "Enable", "LCC": "Enable" }
      },
      "CabinPref": [{ "Cabin": "Y", "PreferLevel": "Preferred" }]
    },
    "TPA_Extensions": {
      "IntelliSellTransaction": { "RequestType": { "Name": "200ITINS" } }
    },
    "TravelerInfoSummary": {
      "AirTravelerAvail": [{ "PassengerTypeQuantity": [{ "Code": "ADT", "Quantity": 2 }] }]
    }
  }
}
```

**Cabin Class Codes:**
| Class | Code |
|-------|------|
| Economy | Y |
| Premium Economy | S |
| Business | C or J |
| First | F |

**Response Formats:**
- Classic: `OTA_AirLowFareSearchRS.PricedItineraries.PricedItinerary[]`
- Grouped (newer): `groupedItineraryResponse.itineraryGroups[].itineraries[]`
- Compressed: `compressedResponse` (base64 gzip — decompress with `zlib.gunzipSync`)

---

## 3. Price Revalidation (v4) <a name="3-price-revalidation"></a>

**Endpoint:** `POST /v4/shop/flights/revalidate`

```json
{
  "OTA_AirLowFareSearchRQ": {
    "Version": "4",
    "OriginDestinationInformation": [{
      "DepartureDateTime": "2026-04-27T14:30:00",
      "ArrivalDateTime": "2026-04-27T18:45:00",
      "OriginLocation": { "LocationCode": "DAC" },
      "DestinationLocation": { "LocationCode": "DXB" },
      "FlightSegment": [{
        "DepartureDateTime": "2026-04-27T14:30:00",
        "ArrivalDateTime": "2026-04-27T18:45:00",
        "FlightNumber": "625",
        "NumberInParty": "1",
        "ResBookDesigCode": "Y",
        "Status": "NN",
        "OriginLocation": { "LocationCode": "DAC" },
        "DestinationLocation": { "LocationCode": "DXB" },
        "MarketingAirline": { "Code": "EK", "FlightNumber": "625" }
      }]
    }],
    "TravelerInfoSummary": {
      "AirTravelerAvail": [{
        "PassengerTypeQuantity": [
          { "Code": "ADT", "Quantity": "1" }
        ]
      }]
    },
    "TPA_Extensions": {
      "IntelliSellTransaction": { "RequestType": { "Name": "REVALIDATE" } }
    }
  }
}
```

**Response:**
```json
{
  "OTA_AirLowFareSearchRS": {
    "PricedItineraries": {
      "PricedItinerary": [{
        "AirItineraryPricingInfo": [{
          "ItinTotalFare": {
            "TotalFare": { "Amount": "45000", "CurrencyCode": "BDT" },
            "BaseFare": { "Amount": "38000" },
            "Taxes": { "Tax": [{ "Amount": "7000" }] }
          },
          "LastTicketDate": "2026-04-25"
        }],
        "ValidatingCarrierCode": "EK"
      }]
    }
  }
}
```

---

## 4. Create Booking / PNR — CreatePassengerNameRecordRQ v2.4.0 <a name="4-create-booking"></a>

**Endpoint:** `POST /v2.4.0/passenger/records?mode=create`
**Timeout:** 60 seconds

### 4a. Full Payload (Production-Verified ✅)

This is the **exact working payload** that created PNR `GCCVGK` with Airlines PNR `09HUGY`:

```json
{
  "CreatePassengerNameRecordRQ": {
    "targetCity": "J4YL",
    "TravelItineraryAddInfo": {
      "AgencyInfo": {
        "Ticketing": { "TicketType": "7TAW" }
      },
      "CustomerInfo": {
        "ContactNumbers": {
          "ContactNumber": [{
            "Phone": "01724597352",
            "PhoneUseType": "H"
          }]
        },
        "Email": [{ "Address": "mike@seventrip.com", "Type": "TO" }],
        "PersonName": [
          {
            "NameNumber": "1.1",
            "GivenName": "MST RAFIZA MS",
            "Surname": "MOSTOFA"
          }
        ]
      }
    },
    "AirBook": {
      "HaltOnStatus": [
        { "Code": "NN" },
        { "Code": "UC" },
        { "Code": "US" },
        { "Code": "UN" }
      ],
      "OriginDestinationInformation": {
        "FlightSegment": [{
          "DepartureDateTime": "2026-04-27T14:30:00",
          "ArrivalDateTime": "2026-04-27T18:45:00",
          "FlightNumber": "141",
          "NumberInParty": "1",
          "ResBookDesigCode": "Y",
          "Status": "NN",
          "OriginLocation": { "LocationCode": "DAC" },
          "DestinationLocation": { "LocationCode": "DXB" },
          "MarketingAirline": { "Code": "BS", "FlightNumber": "141" }
        }]
      }
    },
    "SpecialReqDetails": {
      "SpecialService": {
        "SpecialServiceInfo": {
          "Service": [
            {
              "SSR_Code": "CTCM",
              "Text": "8801724597352",
              "PersonName": { "NameNumber": "1.1" },
              "SegmentNumber": "A"
            },
            {
              "SSR_Code": "CTCE",
              "Text": "MIKE//SEVENTRIP..COM",
              "PersonName": { "NameNumber": "1.1" },
              "SegmentNumber": "A"
            }
          ],
          "AdvancePassenger": [{
            "Document": {
              "Type": "P",
              "Number": "A13888697",
              "ExpirationDate": "2029-03-10",
              "IssueCountry": "BD",
              "NationalityCountry": "BD"
            },
            "PersonName": {
              "NameNumber": "1.1",
              "DateOfBirth": "2003-03-26",
              "Gender": "F",
              "GivenName": "MST RAFIZA",
              "Surname": "MOSTOFA"
            },
            "SegmentNumber": "A",
            "VendorPrefs": { "Airline": { "Hosted": false } }
          }]
        }
      }
    },
    "PostProcessing": {
      "EndTransaction": {
        "Source": { "ReceivedFrom": "SEVEN TRIP API" }
      }
    }
  }
}
```

### 4b. Payload Variant Strategy (Fallback Chain)

The system tries up to 5 variants in order. If passport DOCS are present, `no_special_req` is **disabled** (DOCS strict mode):

| # | Variant Label | Description | When Used |
|---|---------------|-------------|-----------|
| 1 | `full_payload` | Complete: SSR + DOCS with NationalityCountry | Always first |
| 2 | `full_payload_docs_minimal` | SSR + DOCS without NationalityCountry | If #1 fails validation |
| 3 | `full_payload_docs_bare` | DOCS with only NameNumber in PersonName | If #2 fails |
| 4 | `docs_only_no_ssr` | DOCS only, no SSR Service entries | If #3 fails |
| 5 | `no_special_req` | No SpecialReqDetails at all | **ONLY if no passport DOCS** |

**Retry condition:** Error matches `/VALIDATION_FAILED|NotProcessed|AdvancePassenger|Document|PersonName|NamePrefix|not allowed|UNABLE TO PROCESS|FORMAT|INVALID|CHECK FLIGHT/i`

### 4c. Multi-Passenger Payload (Adult + Child + Infant)

```json
{
  "CreatePassengerNameRecordRQ": {
    "targetCity": "J4YL",
    "TravelItineraryAddInfo": {
      "AgencyInfo": { "Ticketing": { "TicketType": "7TAW" } },
      "CustomerInfo": {
        "ContactNumbers": { "ContactNumber": [{ "Phone": "01700000000", "PhoneUseType": "H" }] },
        "Email": [{ "Address": "booking@seventrip.com", "Type": "TO" }],
        "PersonName": [
          { "NameNumber": "1.1", "GivenName": "MD KAOSAR MR", "Surname": "AHMED" },
          { "NameNumber": "2.1", "GivenName": "FATIMA MSTR", "Surname": "AHMED" },
          { "NameNumber": "3.1", "GivenName": "BABY MISS", "Surname": "AHMED" }
        ]
      }
    },
    "AirBook": {
      "HaltOnStatus": [{ "Code": "NN" }, { "Code": "UC" }, { "Code": "US" }, { "Code": "UN" }],
      "OriginDestinationInformation": {
        "FlightSegment": [{
          "DepartureDateTime": "2026-04-27T14:30:00",
          "ArrivalDateTime": "2026-04-27T18:45:00",
          "FlightNumber": "141",
          "NumberInParty": "3",
          "ResBookDesigCode": "Y",
          "Status": "NN",
          "OriginLocation": { "LocationCode": "DAC" },
          "DestinationLocation": { "LocationCode": "DXB" },
          "MarketingAirline": { "Code": "BS", "FlightNumber": "141" }
        }]
      }
    },
    "SpecialReqDetails": {
      "SpecialService": {
        "SpecialServiceInfo": {
          "Service": [
            { "SSR_Code": "CTCM", "Text": "8801700000000", "PersonName": { "NameNumber": "1.1" }, "SegmentNumber": "A" },
            { "SSR_Code": "CTCE", "Text": "BOOKING//SEVENTRIP..COM", "PersonName": { "NameNumber": "1.1" }, "SegmentNumber": "A" },
            { "SSR_Code": "CTCM", "Text": "8801700000000", "PersonName": { "NameNumber": "2.1" }, "SegmentNumber": "A" },
            { "SSR_Code": "CTCE", "Text": "BOOKING//SEVENTRIP..COM", "PersonName": { "NameNumber": "2.1" }, "SegmentNumber": "A" },
            { "SSR_Code": "CTCM", "Text": "8801700000000", "PersonName": { "NameNumber": "3.1" }, "SegmentNumber": "A" },
            { "SSR_Code": "CTCE", "Text": "BOOKING//SEVENTRIP..COM", "PersonName": { "NameNumber": "3.1" }, "SegmentNumber": "A" }
          ],
          "AdvancePassenger": [
            {
              "Document": { "Type": "P", "Number": "A12345678", "ExpirationDate": "2030-06-15", "IssueCountry": "BD", "NationalityCountry": "BD" },
              "PersonName": { "NameNumber": "1.1", "DateOfBirth": "1990-05-15", "Gender": "M", "GivenName": "MD KAOSAR", "Surname": "AHMED" },
              "SegmentNumber": "A",
              "VendorPrefs": { "Airline": { "Hosted": false } }
            },
            {
              "Document": { "Type": "P", "Number": "B98765432", "ExpirationDate": "2031-01-20", "IssueCountry": "BD", "NationalityCountry": "BD" },
              "PersonName": { "NameNumber": "2.1", "DateOfBirth": "2018-08-10", "Gender": "M", "GivenName": "FATIMA", "Surname": "AHMED" },
              "SegmentNumber": "A",
              "VendorPrefs": { "Airline": { "Hosted": false } }
            },
            {
              "Document": { "Type": "P", "Number": "C11223344", "ExpirationDate": "2031-03-05", "IssueCountry": "BD", "NationalityCountry": "BD" },
              "PersonName": { "NameNumber": "3.1", "DateOfBirth": "2025-01-15", "Gender": "FI", "GivenName": "BABY", "Surname": "AHMED" },
              "SegmentNumber": "A",
              "VendorPrefs": { "Airline": { "Hosted": false } }
            }
          ]
        }
      }
    },
    "PostProcessing": {
      "EndTransaction": { "Source": { "ReceivedFrom": "SEVEN TRIP API" } }
    }
  }
}
```

### 4d. Multi-Segment (Round-Trip) Payload

```json
{
  "CreatePassengerNameRecordRQ": {
    "targetCity": "J4YL",
    "TravelItineraryAddInfo": {
      "AgencyInfo": { "Ticketing": { "TicketType": "7TAW" } },
      "CustomerInfo": {
        "ContactNumbers": { "ContactNumber": [{ "Phone": "01700000000", "PhoneUseType": "H" }] },
        "Email": [{ "Address": "booking@seventrip.com", "Type": "TO" }],
        "PersonName": [
          { "NameNumber": "1.1", "GivenName": "JOHN MR", "Surname": "DOE" }
        ]
      }
    },
    "AirBook": {
      "HaltOnStatus": [{ "Code": "NN" }, { "Code": "UC" }, { "Code": "US" }, { "Code": "UN" }],
      "OriginDestinationInformation": {
        "FlightSegment": [
          {
            "DepartureDateTime": "2026-04-27T14:30:00",
            "ArrivalDateTime": "2026-04-27T18:45:00",
            "FlightNumber": "141",
            "NumberInParty": "1",
            "ResBookDesigCode": "Y",
            "Status": "NN",
            "OriginLocation": { "LocationCode": "DAC" },
            "DestinationLocation": { "LocationCode": "DXB" },
            "MarketingAirline": { "Code": "BS", "FlightNumber": "141" }
          },
          {
            "DepartureDateTime": "2026-05-05T20:00:00",
            "ArrivalDateTime": "2026-05-06T04:30:00",
            "FlightNumber": "142",
            "NumberInParty": "1",
            "ResBookDesigCode": "Y",
            "Status": "NN",
            "OriginLocation": { "LocationCode": "DXB" },
            "DestinationLocation": { "LocationCode": "DAC" },
            "MarketingAirline": { "Code": "BS", "FlightNumber": "142" }
          }
        ]
      }
    },
    "SpecialReqDetails": {
      "SpecialService": {
        "SpecialServiceInfo": {
          "Service": [
            { "SSR_Code": "CTCM", "Text": "8801700000000", "PersonName": { "NameNumber": "1.1" }, "SegmentNumber": "A" },
            { "SSR_Code": "CTCE", "Text": "BOOKING//SEVENTRIP..COM", "PersonName": { "NameNumber": "1.1" }, "SegmentNumber": "A" }
          ],
          "AdvancePassenger": [{
            "Document": { "Type": "P", "Number": "A12345678", "ExpirationDate": "2030-06-15", "IssueCountry": "BD", "NationalityCountry": "BD" },
            "PersonName": { "NameNumber": "1.1", "DateOfBirth": "1990-05-15", "Gender": "M", "GivenName": "JOHN", "Surname": "DOE" },
            "SegmentNumber": "A",
            "VendorPrefs": { "Airline": { "Hosted": false } }
          }]
        }
      }
    },
    "PostProcessing": {
      "EndTransaction": { "Source": { "ReceivedFrom": "SEVEN TRIP API" } }
    }
  }
}
```

### 4e. With Meal + Wheelchair SSR

```json
{
  "SpecialReqDetails": {
    "SpecialService": {
      "SpecialServiceInfo": {
        "Service": [
          {
            "SSR_Code": "VGML",
            "VendorPrefs": { "Airline": { "Code": "EK" } },
            "Text": "VGML-AHMED/KAOSAR",
            "PersonName": { "NameNumber": "1.1" },
            "SegmentNumber": "A"
          },
          {
            "SSR_Code": "WCHR",
            "VendorPrefs": { "Airline": { "Code": "EK" } },
            "Text": "AHMED/KAOSAR",
            "PersonName": { "NameNumber": "1.1" },
            "SegmentNumber": "A"
          },
          {
            "SSR_Code": "CTCM",
            "Text": "8801700000000",
            "PersonName": { "NameNumber": "1.1" },
            "SegmentNumber": "A"
          },
          {
            "SSR_Code": "CTCE",
            "Text": "BOOKING//SEVENTRIP..COM",
            "PersonName": { "NameNumber": "1.1" },
            "SegmentNumber": "A"
          }
        ],
        "AdvancePassenger": [
          "... (same DOCS structure as above)"
        ]
      }
    }
  }
}
```

---

## 5. Retrieve Booking — GetBooking v1 <a name="5-retrieve-booking"></a>

**Endpoint:** `POST /v1/trip/orders/getBooking`

```json
{
  "confirmationId": "GCCVGK"
}
```

**Response keys:** `bookingId, startDate, endDate, isCancelable, isTicketed, creationDetails, contactInfo, travelers, flights, journeys, allSegments, specialServices, timestamp, bookingSignature, request, errors`

**Vendor Locator Extraction:** Deep scan for keys matching:
```
vendorlocator|airlinelocator|airlinepnr|airlineconfirmation|vendorconfirmation|
vendorPNR|otherPNR|supplierlocator|reservationnumber|confirmationnumber|
supplierref|operatingairlineconfirmation
```

Plus DC* pattern: `/DC[A-Z]{2}\*([A-Z0-9]{4,8})/i` (e.g., `/DCBS*09HUGY`)

---

## 6. Check Ticket Status <a name="6-check-ticket-status"></a>

**Endpoint:** `POST /v1/trip/orders/checkFlightTickets`

```json
{
  "confirmationId": "GCCVGK"
}
```

**Response:**
```json
{
  "tickets": [{
    "ticketNumber": "9972401234567",
    "status": "ticketed",
    "passengerName": "MOSTOFA/MST RAFIZA MS",
    "issueDate": "2026-03-13",
    "airline": "BS"
  }]
}
```

---

## 7. Issue Ticket — AirTicketRQ v1.3.0 <a name="7-issue-ticket"></a>

**Endpoint:** `POST /v1.3.0/air/ticket`

```json
{
  "AirTicketRQ": {
    "DesignatePrinter": {
      "Printers": {
        "Hardcopy": { "LNIATA": "000000" },
        "Ticket": { "CountryCode": "BD" }
      }
    },
    "Itinerary": { "ID": "GCCVGK" },
    "Ticketing": [{
      "PricingQualifiers": {
        "PriceQuote": [{
          "Record": [{ "Number": "1", "Reissue": false }]
        }]
      }
    }],
    "PostProcessing": {
      "EndTransaction": {
        "Source": { "ReceivedFrom": "SEVEN TRIP API" }
      }
    }
  }
}
```

**Response:**
```json
{
  "AirTicketRS": {
    "Summary": [
      { "DocumentNumber": "9972401234567" }
    ]
  }
}
```

---

## 8. Cancel Booking <a name="8-cancel-booking"></a>

Three REST variants tried in order, then SOAP fallback:

### 8a. OTA_CancelRQ v2.0.2

```json
{
  "OTA_CancelRQ": {
    "Version": "2.0.2",
    "UniqueID": { "ID": "GCCVGK" },
    "Segment": [{ "Type": "entire" }]
  }
}
```
**Endpoint:** `POST /v2.0.2/booking/cancel`

### 8b. OTA_CancelRQ v2.0.0

```json
{
  "OTA_CancelRQ": {
    "Version": "2.0.0",
    "UniqueID": { "ID": "GCCVGK" },
    "Segment": [{ "Type": "entire" }]
  }
}
```
**Endpoint:** `POST /v2.0.0/booking/cancel`

### 8c. Cancel via UpdatePassengerNameRecord

```json
{
  "UpdatePassengerNameRecordRQ": {
    "version": "2.4.0",
    "Itinerary": { "ID": "GCCVGK" },
    "Cancel": {
      "Segment": [{ "Type": "entire" }]
    },
    "PostProcessing": {
      "EndTransaction": {
        "Source": { "ReceivedFrom": "SEVEN TRIP API CANCEL" }
      }
    }
  }
}
```
**Endpoint:** `POST /v2.4.0/passenger/records?mode=update`

### 8d. SOAP Fallback
Uses `cancelPnrViaSoap(pnr)` from `sabre-soap.js` with BinarySecurityToken stateful session.

---

## 9. Seat Map <a name="9-seat-map"></a>

### 9a. REST GetSeats (requires PNR or offerId)

**Variant priority order:**

| Variant | Endpoint | Body |
|---------|----------|------|
| v3 byPnrLocator | `/v3/offers/getseats/byPnrLocator` | `{ "pnrLocator": "GCCVGK" }` |
| v3 confirmationId | `/v3/offers/getseats/byPnrLocator` | `{ "confirmationId": "GCCVGK" }` |
| v1 with POS | `/v1/offers/getseats` | `{ "pointOfSale": { "location": { "countryCode": "BD", "cityCode": "DAC" } }, "requestType": "pnrLocator", "request": { "pnrLocator": "GCCVGK" } }` |
| v1 no POS | `/v1/offers/getseats` | `{ "requestType": "pnrLocator", "request": { "pnrLocator": "GCCVGK" } }` |
| v1 legacy | `/v1/offers/getseats` | `{ "SeatAvailabilityRQ": { "SeatMapQueryEnhanced": { "RequestType": "Payload", "ConfirmationId": "GCCVGK", "Flight": [{ "DepartureDate": "2026-04-27", "Marketing": { "Carrier": "BS", "FlightNumber": 141 }, "Origin": "DAC", "Destination": "DXB" }] } } }` |
| v1 simple | `/v1/offers/getseats` | `{ "confirmationId": "GCCVGK" }` |

### 9b. SOAP Fallback (Pre-Booking — No PNR Needed)

Uses `EnhancedSeatMapRQ v6` via `sabre-soap.js getSeatMap()`:
```js
sabreSoap.getSeatMap({
  origin: 'DAC',
  destination: 'DXB',
  departureDate: '2026-04-27',
  marketingCarrier: 'BS',
  operatingCarrier: 'BS',
  flightNumber: '141',
  cabinClass: 'Economy',
  isDomestic: false,
})
```

---

## 10. Assign Seats — Update PNR <a name="10-assign-seats"></a>

**Endpoint:** `POST /v2.4.0/passenger/records?mode=update&recordLocator=GCCVGK`

```json
{
  "CreatePassengerNameRecordRQ": {
    "targetCity": "J4YL",
    "AirBook": {
      "RetryRebook": { "Option": true }
    },
    "SpecialReqDetails": {
      "SpecialService": {
        "SpecialServiceInfo": {
          "Service": [{
            "SSR_Code": "RQST",
            "Text": "12A",
            "PersonName": { "NameNumber": "1.1" },
            "SegmentNumber": "1",
            "VendorPrefs": { "Airline": { "Code": "BS" } }
          }]
        }
      }
    },
    "PostProcessing": {
      "EndTransaction": { "Source": { "ReceivedFrom": "SEVEN TRIP SEAT" } }
    }
  }
}
```

---

## 11. Add Ancillary SSR — Update PNR <a name="11-add-ancillary-ssr"></a>

**Endpoint:** `POST /v2.4.0/passenger/records?mode=update&recordLocator=GCCVGK`

```json
{
  "CreatePassengerNameRecordRQ": {
    "targetCity": "J4YL",
    "SpecialReqDetails": {
      "SpecialService": {
        "SpecialServiceInfo": {
          "Service": [{
            "SSR_Code": "VGML",
            "Text": "VEGETARIAN MEAL",
            "PersonName": { "NameNumber": "1.1" },
            "SegmentNumber": "A",
            "VendorPrefs": { "Airline": { "Code": "EK" } }
          }]
        }
      }
    },
    "PostProcessing": {
      "EndTransaction": { "Source": { "ReceivedFrom": "SEVEN TRIP ANC" } }
    }
  }
}
```

---

## 12. GDS PNR Extraction Logic <a name="12-pnr-extraction"></a>

From `CreatePassengerNameRecordRS`, PNR is extracted from these paths (in order):

```
1. CreatePassengerNameRecordRS.ItineraryRef.ID
2. CreatePassengerNameRecordRS.TravelItineraryRead.TravelItinerary.ItineraryRef.ID
3. CreatePassengerNameRecordRS.TravelItineraryRead.ItineraryRef.ID
4. response.RecordLocator
5. response.PNR
6. response.BookingReference
7. Deep scan: any key matching /(recordlocator|bookingreference|locator|confirmationid|pnr)$/i
```

**Validation:** Must match `/^[A-Z0-9]{5,8}$/i`

**CRITICAL:** Check `ApplicationResults.status` first — if `NotProcessed` or `Incomplete`, PNR was never created.

---

## 13. Airline PNR Deep Scan <a name="13-airline-pnr-extraction"></a>

The airline PNR (distinct from GDS PNR) is extracted via:

1. **Named fields:** Keys matching `vendorlocator|airlinelocator|airlinepnr|reservationnumber|confirmationnumber|vendorconfirmation|supplierlocator|otherpnr|supplierref|airlineconfirmation|operatingairlineconfirmation`

2. **DC* pattern:** Regex `/\/DC[A-Z]{2}\*([A-Z0-9]{4,8})/i` in any string value
   - Example: `/DCBS*09HUGY` → Airlines PNR = `09HUGY`
   - `DC` = Document Code, `BS` = US-Bangla airline code

3. **GetBooking fallback:** If not found in CreatePNR response, calls `getBooking({ pnr })` and scans vendorLocators.

**Validation:** Must match `/^[A-Z0-9]{5,20}$/` and be DIFFERENT from GDS PNR.

---

## 14. SSR Reference Table <a name="14-ssr-reference"></a>

| SSR Code | Type | Format | Example |
|----------|------|--------|---------|
| **CTCM** | Mobile Contact | E164 (no +) | `8801724597352` |
| **CTCE** | Email Contact | `@` → `//`, `.` → `..` | `MIKE//SEVENTRIP..COM` |
| **VGML** | Vegetarian Meal | `CODE-LASTNAME/FIRSTNAME` | `VGML-AHMED/KAOSAR` |
| **MOML** | Muslim Meal | Same as meal | |
| **AVML** | Asian Veg Meal | Same as meal | |
| **KSML** | Kosher Meal | Same as meal | |
| **DBML** | Diabetic Meal | Same as meal | |
| **CHML** | Child Meal | Same as meal | |
| **BBML** | Baby Meal | Same as meal | |
| **GFML** | Gluten-Free | Same as meal | |
| **SFML** | Seafood Meal | Same as meal | |
| **WCHR** | Wheelchair (Ramp) | `LASTNAME/FIRSTNAME` | `AHMED/KAOSAR` |
| **WCHS** | Wheelchair (Steps) | Same | |
| **WCHC** | Wheelchair (Cabin) | Same | |
| **MEDA** | Medical Assistance | Free text | `MEDICAL ASSISTANCE REQUIRED-AHMED` |
| **BLND** | Blind Passenger | `BLIND PASSENGER-LASTNAME` | |
| **DEAF** | Deaf Passenger | `DEAF PASSENGER-LASTNAME` | |
| **UMNR** | Unaccompanied Minor | `UM{age}-LASTNAME` | `UM10-AHMED` |
| **PETC** | Pet in Cabin | `PET-CABIN` | |
| **AVIH** | Pet in Hold | `PET-CARGO` | |
| **XBAG** | Extra Baggage | `{kg}KG EXTRA BAGGAGE` | `20KG EXTRA BAGGAGE` |
| **FQTV** | Frequent Flyer | `{airline}{number}` | `EK1234567890` |
| **OTHS** | Other/Free Text | Max 70 chars uppercase | `SPECIAL ASSISTANCE NEEDED` |
| **RQST** | Seat Request | `{row}{letter}` | `12A` |

---

## 15. Passenger Name & Title Rules <a name="15-name-title-rules"></a>

### Title Placement
Title goes **at the END** of `GivenName` (Sabre v2.4.0 requirement — `NamePrefix` is NOT allowed):

| Passenger Type | Gender | Title | GivenName Example |
|---------------|--------|-------|-------------------|
| Adult | Male | MR | `MD KAOSAR MR` |
| Adult | Female | MS | `MST RAFIZA MS` |
| Adult | Female (Married) | MRS | `FATIMA MRS` |
| Child (2-11) | Male | MSTR | `RAHIM MSTR` |
| Child (2-11) | Female | MISS | `FATIMA MISS` |
| Infant (0-1) | Male | MSTR | `BABY MSTR` |
| Infant (0-1) | Female | MISS | `BABY MISS` |

### Gender Codes for DOCS
| Gender | Code | Used For |
|--------|------|----------|
| Male | M | Adult/Child |
| Female | F | Adult/Child |
| Male Infant | MI | Infant |
| Female Infant | FI | Infant |

### Name Format
- ALL UPPERCASE
- `Surname` = Last Name
- `GivenName` = First Name + Title (space-separated)
- `NameNumber` = Sequential: `1.1`, `2.1`, `3.1` ...

---

## 16. DOCS (Passport) Payload Rules <a name="16-docs-rules"></a>

### Document Object (ONLY document fields)
```json
{
  "Type": "P",
  "Number": "A13888697",
  "ExpirationDate": "2029-03-10",
  "IssueCountry": "BD",
  "NationalityCountry": "BD"
}
```

### PersonName Object (personal fields — separate from Document)
```json
{
  "NameNumber": "1.1",
  "DateOfBirth": "2003-03-26",
  "Gender": "F",
  "GivenName": "MST RAFIZA",
  "Surname": "MOSTOFA"
}
```

### VendorPrefs (CRITICAL — no Airline.Code!)
```json
{
  "Airline": { "Hosted": false }
}
```
⚠️ **Do NOT include `Airline.Code`** — causes 422 validation error.

### Date Formats
- `ExpirationDate`: `YYYY-MM-DD` (e.g., `2029-03-10`)
- `DateOfBirth`: `YYYY-MM-DD` (e.g., `2003-03-26`)

### Country Codes
- ISO 3166-1 alpha-2 (e.g., `BD`, `AE`, `GB`, `US`)
- Extracted from raw input by stripping non-alpha chars and validating 2-letter code

### Passport Field Smart Detection
The system checks if `passport` field contains a file path vs actual number:
```
File path (SKIP): traveller/passport/xxx.jpg
Real number (USE): A13888697
```
Priority chain: `passportNumber` > `passportNo` > `documentNumber` > `travelDocumentNumber` > `passport` (if not file path)

### DOCS Strict Mode
When passport DOCS exist in `AdvancePassenger`, the `no_special_req` fallback variant is **disabled**. This prevents PNR creation without passport data in the GDS.

---

## Quick Reference: All Sabre Endpoints

| Operation | Method | Endpoint | Version |
|-----------|--------|----------|---------|
| Auth Token | POST | `/v3/auth/token` | v3 |
| Flight Search | POST | `/v5/offers/shop` | BFM v5 |
| Price Revalidation | POST | `/v4/shop/flights/revalidate` | v4 |
| Create PNR | POST | `/v2.4.0/passenger/records?mode=create` | v2.4.0 |
| Update PNR | POST | `/v2.4.0/passenger/records?mode=update&recordLocator={PNR}` | v2.4.0 |
| Get Booking | POST | `/v1/trip/orders/getBooking` | v1 |
| Check Tickets | POST | `/v1/trip/orders/checkFlightTickets` | v1 |
| Issue Ticket | POST | `/v1.3.0/air/ticket` | v1.3.0 |
| Cancel (primary) | POST | `/v2.0.2/booking/cancel` | v2.0.2 |
| Void Tickets | POST | `/v1/trip/orders/voidFlightTickets` | v1 |
| Refund Price | POST | `/v1/offers/refund/price` | v1 |
| Refund Fulfill | POST | `/v1/offers/refund/fulfill` | v1 |
| Flight Status | GET | `/products/air/flight/status` | v1 |
| Stateless Ancillaries | POST | `/v1/offers/getAncillaries` | v1 |
| Add Ancillary | POST | `/v1/offers/addAncillaries` | v1 |
| Fulfill Tickets (EMD) | POST | `/v1/trip/orders/fulfillOrder` | v1 |
| Seat Map REST | POST | `/v3/offers/getseats/byPnrLocator` or `/v1/offers/getseats` | v3/v1 |
| Seat Map SOAP | SOAP | `EnhancedSeatMapRQ v6` via `webservices.platform.sabre.com` | v6 |

---

## TTI (Air Astra) Endpoints

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Search | POST | `/<SearchFlights>` |
| Book | POST | `/<CreateBooking>?BodyStyle=Bare` |
| Cancel | POST | `/<Cancel>?BodyStyle=Bare` |
| Void | POST | `/<CancelBooking>?BodyStyle=Bare` |
| Ticket | POST | `/<IssueTicket>?BodyStyle=Bare` |

### TTI Booking Payload (Production-Verified ✅)

```json
{
  "RequestInfo": { "AuthenticationKey": "<TTI_API_KEY>" },
  "Booking": {
    "Passengers": [{
      "Ref": "1",
      "RefClient": null,
      "PassengerQuantity": 1,
      "PassengerTypeCode": "AD",
      "NameElement": {
        "CivilityCode": "MR",
        "FirstName": "MD KAOSAR",
        "LastName": "AHMED"
      },
      "DateOfBirth": "/Date(631152000000+0100)/",
      "PassportNumber": "A12345678",
      "PassportExpiry": "/Date(1901232000000+0100)/",
      "GenderCode": "M",
      "DocumentInfo": {
        "DocumentNumber": "A12345678",
        "NationalityCode": "BD"
      }
    }],
    "Segments": [{
      "Ref": "1",
      "From": "DAC",
      "To": "CXB",
      "Carrier": "2A",
      "FlightNumber": "443",
      "DepartureDate": "/Date(1712966400000+0100)/",
      "BookingClass": "S"
    }],
    "FareInfo": {
      "ETTicketFares": [{
        "RefPassenger": "1",
        "RefItinerary": "IT_0"
      }]
    },
    "ContactInfo": {
      "Email": "booking@seventrip.com",
      "Phone": "01700000000"
    }
  }
}
```

### TTI Cancel Payload (Production-Verified ✅)

```json
{
  "RequestInfo": { "AuthenticationKey": "<TTI_API_KEY>" },
  "UniqueID": { "ID": "00KTUN" },
  "CancelSettings": { "CancelSegmentSettings": {} }
}
```

### TTI Response Fields

| Field | Path | Example |
|---|---|---|
| PNR Code | `Booking.PnrInformation.PnrCode` | `00KTUN` |
| Status | `Booking.PnrInformation.PnrStatusCode` | `Option` (reserved) |
| Time Limit | `Booking.PnrInformation.TimeLimit` | `/Date(1773585817906+0100)/` |
| Booking ID | `Booking.FareInfo.ETTicketFares[0].Ref` | `16755091` |
| Total Fare | `Booking.FareInfo.SaleCurrencyAmountToPay.TotalAmount` | `5099` |
| Baggage | `ETTicketFares[0].CouponFares[0].BagAllowances[0]` | `{ Weight: 20, WeightMeasureQualifier: "KG" }` |
| Taxes | `ETTicketFares[0].Taxes[]` | `[{ Code: "BD", Amount: 25 }, { Code: "OW", Amount: 700 }, ...]` |
| Fare Rules | `FareInfo.FareRules[0].Details` | Exchange/Refund penalties by time bracket |

---

## Production Config (system_settings)

```json
{
  "enabled": "true",
  "environment": "production",
  "pcc": "J4YL",
  "epr": "631470",
  "prod_client_id": "...",
  "prod_client_secret": "...",
  "prod_basic_auth": "...",
  "prodPassword": "...",
  "prod_url": "https://api.platform.sabre.com",
  "sandbox_url": "https://api.cert.platform.sabre.com"
}
```

Stored in: `system_settings` table, key: `api_sabre`

---

## Probe Evidence — All 9 PNRs (2026-03-14)

| PNR | Provider | Route | Pax | Status |
|-----|----------|-------|-----|--------|
| DXGDPD | Sabre | DAC→DXB | 1 ADT | Created + Cancelled ✅ |
| KIIRIF | Sabre | DAC→DXB | ADT+CHD+INF | Created + Cancelled ✅ |
| KFGUNO | Sabre | DAC→SIN→DAC | 1 ADT RT | Created + Cancelled ✅ |
| KLQPYW | Sabre | DAC→BKK | ADT+CHD | Created + Cancelled ✅ |
| LQRTND | Sabre | DAC→KUL | 2 ADT | Created + Cancelled ✅ |
| 00KTUN | TTI | DAC→CXB | 1 ADT | Created + Cancelled ✅ |
| 00KTUP | TTI | DAC→CXB | ADT+CHD+INF+WCHR | Created + Cancelled ✅ |
| 00KTUQ | TTI | DAC→CGP→DAC | 1 ADT RT | Created + Cancelled ✅ |
| 00KTUS | TTI | DAC→CXB | ADT+CHD | Created + Cancelled ✅ |

---

*Last updated: 2026-03-14 | v4.1.1 | All 26 Sabre sections + TTI payloads | 100% probe pass rate*
