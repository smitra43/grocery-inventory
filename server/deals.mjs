/**
 * Pure helpers for turning Kroger Products API responses into deals.
 * Kept separate from the HTTP server so they can be unit-tested.
 */

/** Flatten a Products API `data[]` entry into the fields the app uses. */
export function normalizeProduct(p) {
  const item = p.items?.[0] ?? {};
  const regular = item.price?.regular ?? null;
  // Kroger returns promo: 0 when there is no promotion.
  const promo = item.price?.promo ? item.price.promo : null;
  const image =
    p.images?.find((i) => i.perspective === 'front')?.sizes?.find((s) => s.size === 'medium')?.url ??
    p.images?.[0]?.sizes?.[0]?.url ??
    null;
  return {
    productId: p.productId,
    description: p.description,
    brand: p.brand ?? null,
    size: item.size ?? null,
    regular,
    promo,
    image,
  };
}

/** A product counts as a deal when its promo price is at least `minPct` below regular. */
export function dealInfo(product, minPct = 0.1) {
  if (product.regular == null || product.promo == null) return null;
  if (product.promo >= product.regular) return null;
  const savings = Math.round((product.regular - product.promo) * 100) / 100;
  const pct = savings / product.regular;
  if (pct < minPct) return null;
  return { savings, pct: Math.round(pct * 100) };
}

/** Best (largest % off) deal among products for one search term, or null. */
export function bestDeal(products, minPct = 0.1) {
  let best = null;
  for (const raw of products) {
    const product = normalizeProduct(raw);
    const deal = dealInfo(product, minPct);
    if (deal && (!best || deal.pct > best.pct)) best = { ...product, ...deal };
  }
  return best;
}
