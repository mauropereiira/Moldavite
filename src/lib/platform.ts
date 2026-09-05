/**
 * Where the app is running, decided from the webview's user agent.
 *
 * Tauri hands the same React app a phone-sized WKWebView on iOS, so the
 * layout has to know it is on a phone rather than merely in a narrow window:
 * a phone has no hover, no resizable columns, a software keyboard and safe
 * areas. `main.tsx` stamps the answer on `<html data-platform>` so CSS and
 * the Tailwind `mobile:` variant can key off it.
 *
 * iPadOS reports itself as a Mac, so touch points decide that case.
 */
export function isMobilePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}
