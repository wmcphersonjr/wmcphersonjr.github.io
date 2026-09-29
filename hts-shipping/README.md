# HTS Shipping Desk

A small local app for customs prep on US imports, backed by the
[USITC Harmonized Tariff Schedule REST API](https://hts.usitc.gov/reststop).

## Run it

Requires Node 18 or newer. No `npm install` needed — there are no dependencies.

```sh
cd hts-shipping
npm start            # or: node server.js
# open http://localhost:3000
```

Set `PORT=8080` to use a different port.

## What it does

1. **Classify** — search the HTS by keyword or number. "Details" shows the full
   heading hierarchy, the General / Special / Column 2 rates (inherited from the
   parent line when a 10-digit code has none), units, and footnotes. Footnotes
   that point at Chapter 99 (Section 301, 232, etc.) are flagged.
2. **Shipment** — build line items (description, HTS code, origin, qty, value,
   weight). Each line estimates duty:
   - ad valorem (`5.3%`), specific (`2.2¢/kg`, `$1.03/kg`) and compound rates
   - Column 2 rates for Cuba, North Korea, Russia, Belarus
   - optional free-trade preference (USMCA, KORUS, CAFTA-DR, etc.) when the
     origin's program code appears in the Special column
   - a per-line "extra duty %" for Chapter 99 add-ons you enter yourself
   - Merchandise Processing Fee (formal/informal) and Harbor Maintenance Fee
     (ocean), editable under **Fee settings**
3. **Documents** — a printable commercial invoice plus CSV/JSON export and JSON
   import. The shipment is saved in your browser's local storage.

## How it talks to the API

`server.js` serves `public/` and proxies two routes (with a 1-hour in-memory cache)
so the browser avoids CORS:

| Local route | HTS API |
| --- | --- |
| `GET /api/search?q=cotton shirt` | `/reststop/search?keyword=…` |
| `GET /api/range?from=6109&to=6110` | `/reststop/exportList?from=…&to=…&format=JSON` |

## Caveats

Estimates only. Additional tariffs under Chapter 99 change frequently and are not
computed automatically; fee amounts are adjusted every fiscal year. Confirm
classification and duties with a licensed customs broker or a CBP binding ruling.
