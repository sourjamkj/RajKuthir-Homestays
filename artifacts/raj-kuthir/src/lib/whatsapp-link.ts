/**
 * Which WhatsApp the console opens.
 *
 * A wa.me link opens whichever WhatsApp Android treats as the default for
 * links — usually the personal app, even when the Raj Kuthir number lives
 * in WhatsApp Business. On Android, an intent link can name the app, so with
 * "WhatsApp Business" chosen every console link opens there instead.
 *
 * The choice is per device (stored in this browser), and guests are never
 * affected: without a stored choice every link is left exactly as it was.
 */

export type WhatsappApp = 'default' | 'business' | 'personal';

const KEY = 'rk_whatsapp_app';
const PACKAGES: Record<Exclude<WhatsappApp, 'default'>, string> = {
  business: 'com.whatsapp.w4b',
  personal: 'com.whatsapp',
};

export function getWhatsappApp(): WhatsappApp {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'business' || value === 'personal' ? value : 'default';
  } catch {
    return 'default';
  }
}

export function setWhatsappApp(app: WhatsappApp): void {
  try {
    if (app === 'default') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, app);
  } catch {
    /* private mode: the choice simply is not remembered */
  }
}

const isAndroid = () => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

/**
 * https://wa.me/919830040042?text=Hi -> an Android intent that opens the
 * chosen app on that chat with the text filled in, falling back to the
 * original link if the app is not installed. Anything else is returned as is.
 */
export function preferredWhatsappUrl(url: string): string {
  const app = getWhatsappApp();
  if (app === 'default' || !isAndroid()) return url;
  const match = /^https:\/\/(?:wa\.me|api\.whatsapp\.com\/send)\/?(\d*)\/?(?:\?(.*))?$/i.exec(url.trim());
  if (!match) return url;
  const phone = match[1] || new URLSearchParams(match[2] ?? '').get('phone') || '';
  const text = new URLSearchParams(match[2] ?? '').get('text') ?? '';
  const query = [phone ? `phone=${phone}` : '', text ? `text=${encodeURIComponent(text)}` : ''].filter(Boolean).join('&');
  return (
    `intent://send/?${query}#Intent;scheme=whatsapp;package=${PACKAGES[app]};` +
    `S.browser_fallback_url=${encodeURIComponent(url)};end`
  );
}

let installed = false;

/**
 * Routes every WhatsApp link the console opens — plain links and
 * window.open alike — through preferredWhatsappUrl. Installed once.
 */
export function installWhatsappLinks(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  document.addEventListener(
    'click',
    (event) => {
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const target = preferredWhatsappUrl(anchor.href);
      if (target === anchor.href) return;
      event.preventDefault();
      window.location.href = target;
    },
    true,
  );

  const open = window.open.bind(window);
  window.open = ((url?: string | URL, ...rest: unknown[]) => {
    const href = url ? String(url) : url;
    const target = typeof href === 'string' ? preferredWhatsappUrl(href) : href;
    if (typeof target === 'string' && target.startsWith('intent://')) {
      window.location.href = target;
      return null;
    }
    return open(target as string, ...(rest as [string?, string?]));
  }) as typeof window.open;
}
