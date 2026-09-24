# Larder — grocery inventory

A web app you install on your phone and desktop (a PWA) to:

- **Scan receipts**: photograph a receipt and the phone reads it into line items. No AI service and no account; the photo never leaves the device. You review everything before it's saved, and the app remembers your corrections.
- **Track groceries**: what you bought, when, how much, what you paid, and when it expires. If you leave the expiry blank, it's estimated from the category and where you store it.
- **Suggest recipes** ranked by how much soon-to-expire food they use up.
- **Track spending** by month and category, including money spent on food you threw away.
- **Track macros**: cooking a recipe logs its macros, and there's a quick-add for everything else.
- **Kroger deals**: finds sales at your store on the ingredients you're missing for each recipe.

## Run it

```bash
npm install
cp .env.example .env        # Kroger keys for deals (optional)
npm run build && npm run server   # http://localhost:8787
```

For development: `npm run server` in one terminal and `npm run dev` in another (Vite proxies `/api` to the server).

### Put it on your phone (Android / Chrome)

1. Sign up at <https://render.com> with your GitHub account (the free plan is enough).
2. **New → Blueprint** → choose this repo. Render reads `render.yaml` and creates a web service.
3. The Kroger keys are optional; leave them blank for now. `APP_KEY` is generated for you; copy it from the service's **Environment** tab.
4. When the deploy finishes, open the `https://larder-….onrender.com` URL in Chrome on your phone and tap **⋮ → Install app**.
5. In the app, go to **Settings → Server access key** and paste the `APP_KEY` (only needed for Kroger deals).

On the free plan the server sleeps when idle, so the app can take about a minute to open after a break. Your groceries are stored on the phone, not the server, so nothing is lost when it sleeps.

## Kroger setup

1. Create an app at <https://developer.kroger.com> and get the client ID and secret.
2. Put them in `.env`. The secret stays on the server; the browser never sees it.
3. In the app, go to **Settings → Kroger store**, search by ZIP code, and pick your store.
4. On **Deals**, click **Check deals**. Kroger responses are cached for 6 hours.

**Limitation:** Kroger's public API has no purchase or order history. "Connecting your account" can't import what you bought. Deals use the Products API, which gives regular and promo prices per store.

## Receipt scanning

Everything runs in the phone's browser (`src/lib/ocr.ts`, `src/lib/receiptParser.ts`):

1. **Clean up the photo** on a canvas: scale to ~1600 px wide, measure and undo the tilt (projection-profile deskew), crop to the paper, and binarize with an adaptive threshold so shadows and faded thermal print come out as clean black on white.
2. **Read the text** with [Tesseract](https://github.com/naptha/tesseract.js) compiled to WebAssembly. Its engine and English model are served from `/ocr/` (copied from `node_modules` by `npm run ocr-assets`), about 7 MB downloaded once per device.
3. **Parse the lines with rules**: price at the end of a line, "SC KROGER SAVINGS 1.00-" subtracted from the item above, "1.62 lb @ 3.99 /lb" and "2 @ 1.25" read as quantities, tax/total/payment lines skipped, common OCR slips fixed ("1b"→"lb", "2.O9"→"2.09"), and Kroger abbreviations expanded ("KRO BNLS SKNLS CHKN BRST" → "Boneless skinless chicken breast").
4. **Learn from you**: every line you confirm is saved as a correction keyed by the receipt text, and next time it's filled in without edits.

Tested on a rendered Kroger-style receipt: a clean, flat photo reads 7/7 items correctly in about 2 seconds. A tilted, blurry, faded photo finds 6/7 items with correct prices but garbled names. Real photos will vary; take them flat, in good light, filling the frame.

## Where your data lives

Everything is stored in IndexedDB on each device, with no account or cloud. Your phone and your computer **don't sync**. Use **Settings → Export / Import** to move data between them. Real sync is the next big decision; see below.

## Layout

```
src/lib/        pure logic (unit-tested): expiry estimates, recipe scoring, spending, macros, receipt OCR + parsing
src/components/ one screen per tab
src/db.ts       IndexedDB (Dexie) schema + backup
server/         Kroger proxy + static file server (no dependencies)
tests/          vitest
```

`npm test` runs the unit tests and `npm run typecheck` runs TypeScript.

## Not built yet (in rough priority order)

1. **Sync between devices**: needs a hosted backend (e.g. Supabase) and a login.
2. **Faster entry**: barcode scanning for single items.
3. **Better OCR on bad photos**: a receipt-trained Tesseract model, or perspective correction for photos taken at an angle.
4. **Scheduled deal alerts**: a daily server job with Web Push. Today the app checks when you click the button.
5. **More recipes**: the library has 16 built-in recipes. Options: a recipe API such as Spoonacular, or generating recipes with an LLM from what's in the fridge.
6. **Per-item nutrition**: macros come from recipes and manual entries, not from each grocery item.
