export interface NormalizedProduct {
  productId: string;
  description: string;
  brand: string | null;
  size: string | null;
  regular: number | null;
  promo: number | null;
  image: string | null;
}
export function normalizeProduct(p: unknown): NormalizedProduct;
export function dealInfo(product: NormalizedProduct, minPct?: number): { savings: number; pct: number } | null;
export function bestDeal(products: unknown[], minPct?: number): (NormalizedProduct & { savings: number; pct: number }) | null;
