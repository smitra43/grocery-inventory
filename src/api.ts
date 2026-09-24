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

const KEY_STORAGE = 'larder-app-key';

export function getAppKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function setAppKey(key: string): void {
  try {
    localStorage.setItem(KEY_STORAGE, key.trim());
  } catch {
    // Storage blocked; the key only lasts this session.
  }
}

/** fetch with the server access key attached. */
function api(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const key = getAppKey();
  if (key) headers.set('x-app-key', key);
  return fetch(path, { ...init, headers });
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export async function krogerStatus(): Promise<boolean> {
  try {
    return (await json<{ configured: boolean }>(await api('/api/kroger/status'))).configured;
  } catch {
    return false;
  }
}

export async function findLocations(zip: string): Promise<KrogerLocation[]> {
  return json(await api(`/api/kroger/locations?zip=${encodeURIComponent(zip)}`));
}

export async function findDeals(locationId: string, terms: string[]): Promise<Record<string, KrogerDeal | null>> {
  const res = await api('/api/kroger/deals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locationId, terms }),
  });
  return (await json<{ deals: Record<string, KrogerDeal | null> }>(res)).deals;
}

export interface MealLookup {
  found: boolean;
  url?: string;
  title?: string;
  servings?: number;
  macros?: import('./lib/types').Macros | null;
  ingredients?: string[];
}

/** Recipe details from homechef.com, via our server. Returns { found: false } when offline or not found. */
export async function lookupHomeChefMeal(name: string): Promise<MealLookup> {
  try {
    return await json<MealLookup>(await api(`/api/homechef/meal?name=${encodeURIComponent(name)}`));
  } catch {
    return { found: false };
  }
}
