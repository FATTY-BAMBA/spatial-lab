// Lets the app's browser modules (src/…) load under Node for tests: the few globals they touch at import time.
globalThis.location ??= { pathname: '/', search: '', hash: '', origin: 'http://localhost' };
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document ??= { documentElement: { lang: 'zh-Hant' } };
export const REPO = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
export const QA = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
