/* موجّه بسيط يعتمد على الهاش — يعمل على أي استضافة ثابتة */

const routes = [];
let notFound = null;
let onChange = null;

export function route(pattern, handler) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => {
    keys.push(m.slice(1));
    return '([^/]+)';
  }) + '$');
  routes.push({ rx, keys, handler, pattern });
}

export const setNotFound = (fn) => { notFound = fn; };
export const setOnChange = (fn) => { onChange = fn; };

export const currentPath = () => (location.hash || '#/home').slice(1) || '/home';

export function go(path, { replace = false } = {}) {
  const target = '#' + path;
  if (location.hash === target) { resolve(); return; }
  if (replace) history.replaceState(null, '', target);
  else location.hash = target;
  if (replace) resolve();
}

export function back(fallback = '/home') {
  if (history.length > 1) history.back();
  else go(fallback, { replace: true });
}

export function resolve() {
  const path = currentPath();
  for (const r of routes) {
    const m = path.match(r.rx);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      onChange?.(path, r.pattern);
      r.handler(params);
      return;
    }
  }
  onChange?.(path, null);
  notFound?.(path);
}

export function start() {
  window.addEventListener('hashchange', resolve);
  resolve();
}
