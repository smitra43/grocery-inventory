export interface KrogerLocation {
  locationId: string;
  name: string;
  chain: string;
  address: string;
}

export interface KrogerDeal {
  productId: string;
  description: string;
  brand: string | null;
  size: string | null;
  regular: number;
  promo: number;
  savings: number;
  pct: number;
  image: string | null;
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export async function krogerStatus(): Promise<boolean> {
  try {
    return (await json<{ configured: boolean }>(await fetch('/api/kroger/status'))).configured;
  } catch {
    return false;
  }
}

export async function findLocations(zip: string): Promise<KrogerLocation[]> {
  return json(await fetch(`/api/kroger/locations?zip=${encodeURIComponent(zip)}`));
}

export async function findDeals(locationId: string, terms: string[]): Promise<Record<string, KrogerDeal | null>> {
  const res = await fetch('/api/kroger/deals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locationId, terms }),
  });
  return (await json<{ deals: Record<string, KrogerDeal | null> }>(res)).deals;
}
