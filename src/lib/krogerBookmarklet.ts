/** Hash prefix the kroger.com importer uses to hand receipts to the app. */
export const IMPORT_HASH = '#import=';

/** Pull receipt text handed over by the bookmarklet from the URL hash, and clear it. */
export function takeImportFromHash(): string | null {
  if (!location.hash.startsWith(IMPORT_HASH)) return null;
  let text: string | null = null;
  try {
    text = decodeURIComponent(location.hash.slice(IMPORT_HASH.length));
  } catch {
    text = null;
  }
  try {
    history.replaceState(null, '', '#inventory');
  } catch {
    // ignore
  }
  return text;
}
