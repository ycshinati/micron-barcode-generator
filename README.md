# Micron Barcode & Label Generator

Local web app for Micron Global ATPRO / BEPRO *Barcode & Shipping Label Requirements*.

**Workflow (v1.4):** Packing slip first → part list drives label count → one **outer + inner** label pair per part (one SAP PN per carton).

| Step | What |
|------|------|
| 1 | Shipment options (Hardware / Component reels, date mode) |
| 2 | Packing slip + **part list** |
| 3 | Per-part fields (lot, serial, date…) shared by that part’s outer + inner |
| Preview | Packing slip or any generated label |
| Print | **Print current** or **Print all** (slip + every outer/inner) |

## Run (local)

```bash
cd "D:\Development\MICRON BARCODE GENERATOR"
npm start
```

Open http://localhost:5173 (requires network for `bwip-js` / `pdf.js` CDNs).

## Team hosting (GitHub Pages)

The app deploys from GitHub Actions on every push to `main`.

**Team URL:** https://ycshinati.github.io/micron-barcode-generator/

Notes for the team:

- No install — open the URL in Edge/Chrome.
- Each user’s form data stays in their own browser (`localStorage`), not a shared database.
- **Load PO** needs outbound internet (pdf.js CDN).

## Use

1. Enter packing slip (PO, packing slip #, invoice).
2. Add parts to the **part list** (part number + qty).  
   → App creates **N outer + N inner** label slots.
3. Complete lot / serial / date for each part in section 3.
4. Preview via the dropdown; **Print current** or **Print all**.

### Save / load

| Action | Behavior |
|--------|----------|
| **Auto-save** | Full shipment saved to the browser as you type |
| **Save data** | Browser save + `.json` backup download |
| **Load data** | Restore from `.json` (legacy single-label saves are migrated) |

## Load PO (PDF)

Use **Load PO** / **Load PO PDF** with a Micron SAP Business Network (Ariba) purchase-order PDF — English or Korean.

Auto-filled from Ariba columns:

| PO column | Label field |
|-----------|-------------|
| Customer Part # (e.g. `830-96265`) | **(P)** Part Number |
| Part # / Description (e.g. `B00003058`) | **(1P)** |
| Qty (EA) | Quantity + total |
| PO number | (K) PO |

Default manufacturer `ATI`. Still enter manually: packing slip #, invoice, lot, serial, date code / expiry, origin.

Requires network access to the pdf.js CDN (same pattern as bwip-js).

## Encoding

### Label 1D
Code 128: `*{DI}{data}*`

### Label 2D
```text
P{part}|1P{mpn}|1T{lot}|7Q{qty}+EA|S{serial}|21P{mfr}|9D{yyyymmdd}|4L{origin}
```
Component **inner** appends `|7E{msl}`.

### Packing slip
Packing Slip (11K), Invoice*, PO (K), Total Qty (7Q), part list rows (P)+(7Q).  
\* Invoice DI not specified in BEPRO — encoded as `*{invoice}*`.

## Tests

```bash
npm test
```

## Compliance

Targets ISO/IEC 15416 print geometry. Letter grades need a physical verifier.

## Version

`1.6.3` — Host on GitHub Pages for team sharing.  
`1.6.2` — Lot / serial / date optional; date code validated as YYYYMMDD when set.  
`1.6.1` — Show package validation errors on the part card and in Status.  
`1.6.0` — Individually packaged: outer qty N → N inner labels at qty 1.  
`1.5.2` — PO map: Customer Part # → (P), Part # → (1P).  
`1.5.1` — PO map: Part # → (P), Customer Part # → (1P).  
`1.5.0` — Load Micron Ariba PO PDF (EN/KO) → packing slip part list + labels.  
`1.4.6` — Outer/inner: 1D–2D gap 12mm.  
`1.4.5` — Outer/inner: 2D inset 5mm from top/right; 15mm gap from 1D.  
`1.4.4` — Outer/inner: 2D inset 10mm from top/right; ≥20mm gap from 1D.  
`1.4.3` — More space between label 1D barcodes and the 2D Data Matrix.  
`1.4.2` — Shorter 1D barcodes (narrower modules + max print width) for easier scanning.  
`1.4.1` — Fix print: barcodes are snapshotted to images so they appear in PDF/print.
