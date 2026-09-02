// pattern: Functional Core

const BILIBILI_PAGE_ORIGIN = 'https://www.bilibili.com';
const BILIBILI_MEDIA_SUFFIX = '.bilivideo.com';

/** Validates an in-memory Bilibili media URL against the current page origin. */
export function isAllowedBilibiliMediaUrl(urlValue: string, pageUrl: string): boolean {
  try {
    const page = new URL(pageUrl);
    const media = new URL(urlValue);
    return page.origin === BILIBILI_PAGE_ORIGIN
      && media.protocol === 'https:'
      && media.username === ''
      && media.password === ''
      && isBilibiliMediaHostname(media.hostname)
      && media.pathname.toLowerCase().endsWith('.m4s');
  } catch {
    return false;
  }
}

/** Removes signed query parameters before a media URL enters diagnostics. */
export function sanitizeMediaUrl(urlValue: string): string {
  try {
    const url = new URL(urlValue);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '[invalid media URL]';
  }
}

function isBilibiliMediaHostname(hostname: string): boolean {
  return hostname === BILIBILI_MEDIA_SUFFIX.slice(1) || hostname.endsWith(BILIBILI_MEDIA_SUFFIX);
}
