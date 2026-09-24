export const MODEL: string;
export const MAX_IMAGES: number;
export const RECEIPT_SCHEMA: Record<string, unknown>;
export function cleanReceipt(raw: unknown): {
  store: string;
  date: string;
  total: number;
  items: Array<{
    name: string;
    receiptText: string;
    category: string;
    location: string;
    quantity: number;
    unit: string;
    price: number;
    isFood: boolean;
  }>;
};
export function validateImages(images: unknown): string | null;
export function scanReceipt(images: Array<{ mediaType: string; data: string }>): Promise<ReturnType<typeof cleanReceipt>>;
