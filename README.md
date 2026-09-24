# Larder — grocery inventory

A web app you install on your phone and desktop (a PWA) to:

- **Track groceries**: what you bought, when, how much, what you paid, and when it expires. If you leave the expiry blank, it's estimated from the category and where you store it.
- **Suggest recipes** ranked by how much soon-to-expire food they use up.
- **Track spending** by month and category, including money spent on food you threw away.
- **Track macros**: cooking a recipe logs its macros, and there's a quick-add for everything else.
- **Kroger deals**: finds sales at your store on the ingredients you're missing for each recipe.

## Run it

```bash
npm install
cp .env.example .env        # add Kroger keys (optional, only needed for deals)
npm run build && npm run server   # http://localhost:8787
```

For development: `npm run server` in one terminal and `npm run dev` in another (Vite proxies `/api` to the server).

To install on your phone, open the site in Safari or Chrome and choose "Add to Home Screen". Service workers need HTTPS, so on a phone this only works once the app is deployed (any Node host works).

## Kroger setup

1. Create an app at <https://developer.kroger.com> and get the client ID and secret.
2. Put them in `.env`. The secret stays on the server; the browser never sees it.
3. In the app, go to **Settings → Kroger store**, search by ZIP code, and pick your store.
4. On **Deals**, click **Check deals**. Kroger responses are cached for 6 hours.

**Limitation:** Kroger's public API has no purchase or order history. "Connecting your account" can't import what you bought. Deals use the Products API, which gives regular and promo prices per store.

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
2. **Faster entry**: barcode scanning, and receipt OCR (photo → line items).
3. **Scheduled deal alerts**: a daily server job with Web Push. Today the app checks when you click the button.
4. **More recipes**: the library has 16 built-in recipes. Options: a recipe API such as Spoonacular, or generating recipes with an LLM from what's in the fridge.
5. **Per-item nutrition**: macros come from recipes and manual entries, not from each grocery item.
