# Larder — grocery inventory

A web app you install on your phone and desktop (a PWA) to:

- **Scan receipts**: photograph a receipt and Claude reads it into line items. You review and edit everything before it's saved.
- **Track groceries**: what you bought, when, how much, what you paid, and when it expires. If you leave the expiry blank, it's estimated from the category and where you store it.
- **Suggest recipes** ranked by how much soon-to-expire food they use up.
- **Track spending** by month and category, including money spent on food you threw away.
- **Track macros**: cooking a recipe logs its macros, and there's a quick-add for everything else.
- **Kroger deals**: finds sales at your store on the ingredients you're missing for each recipe.

## Run it

```bash
npm install
cp .env.example .env        # add keys: Anthropic (receipt scanning) and Kroger (deals); both optional
npm run build && npm run server   # http://localhost:8787
```

For development: `npm run server` in one terminal and `npm run dev` in another (Vite proxies `/api` to the server).

### Put it on your phone (Android / Chrome)

1. Sign up at <https://render.com> with your GitHub account (the free plan is enough).
2. **New → Blueprint** → choose this repo. Render reads `render.yaml` and creates a web service.
3. Fill in `ANTHROPIC_API_KEY` (from <https://console.anthropic.com>). The Kroger keys are optional. `APP_KEY` is generated for you; copy it from the service's **Environment** tab.
4. When the deploy finishes, open the `https://larder-….onrender.com` URL in Chrome on your phone and tap **⋮ → Install app**.
5. In the app, go to **Settings → Server access key** and paste the `APP_KEY`.

On the free plan the server sleeps when idle, so the first receipt scan after a break takes about a minute. Your groceries are stored on the phone, not the server, so nothing is lost when it sleeps.

## Kroger setup

1. Create an app at <https://developer.kroger.com> and get the client ID and secret.
2. Put them in `.env`. The secret stays on the server; the browser never sees it.
3. In the app, go to **Settings → Kroger store**, search by ZIP code, and pick your store.
4. On **Deals**, click **Check deals**. Kroger responses are cached for 6 hours.

**Limitation:** Kroger's public API has no purchase or order history. "Connecting your account" can't import what you bought. Deals use the Products API, which gives regular and promo prices per store.

## Receipt scanning

Set `ANTHROPIC_API_KEY` in `.env`. The photo is shrunk on the phone, and long receipts are split into overlapping slices so small print stays readable. The server then sends it to Claude (`claude-opus-5` by default; override with `RECEIPT_MODEL`). Claude returns structured line items: it expands abbreviations like "KRO BNLS CHKN BRST", folds savings lines into item prices, and skips tax and totals. Non-food items arrive unticked. Expiry dates are estimated, because receipts don't print them.

The request opts into server-side refusal fallbacks (`fallbacks: "default"`), so if a request is declined it's retried on another model instead of failing.

## Where your data lives

Everything is stored in IndexedDB on each device, with no account or cloud. Your phone and your computer **don't sync**. Use **Settings → Export / Import** to move data between them. Real sync is the next big decision; see below.

## Layout

```
src/lib/        pure logic (unit-tested): expiry estimates, recipe scoring, spending, macros
src/components/ one screen per tab
src/db.ts       IndexedDB (Dexie) schema + backup
server/         Kroger proxy + static file server (no dependencies)
tests/          vitest
```

`npm test` runs the unit tests and `npm run typecheck` runs TypeScript.

## Not built yet (in rough priority order)

1. **Sync between devices**: needs a hosted backend (e.g. Supabase) and a login.
2. **Faster entry**: barcode scanning for single items.
3. **Scheduled deal alerts**: a daily server job with Web Push. Today the app checks when you click the button.
4. **More recipes**: the library has 16 built-in recipes. Options: a recipe API such as Spoonacular, or generating recipes with an LLM from what's in the fridge.
5. **Per-item nutrition**: macros come from recipes and manual entries, not from each grocery item.
