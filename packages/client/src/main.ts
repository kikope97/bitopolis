import { randomBase62 } from './session.ts';
import { apply as applyPrefs } from './prefs.ts';
import { drawPixelIcons } from './icons.ts';
import { drawSkyline } from './skyline.ts';
import { showStart } from './start.ts';
import './style.css';

applyPrefs();
drawSkyline();
drawPixelIcons();
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', applyPrefs);

// PWA: instalable y con carga rápida (solo en HTTPS o localhost).
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}

/** Rutas: /p/<token> es una partida; cualquier otra crea una URL nueva. */
const m = location.pathname.match(/^\/p\/([0-9A-Za-z]{22})\/?$/);
const last = (() => {
  try {
    return localStorage.getItem('bitopolis.last');
  } catch {
    return null;
  }
})();
if (m) {
  try {
    localStorage.setItem('bitopolis.last', m[1]!);
  } catch {
    /* sin almacenamiento */
  }
  void showStart(m[1]!);
} else if (new URLSearchParams(location.search).has('pwa') && last && /^[0-9A-Za-z]{22}$/.test(last)) {
  // Abierta desde el icono instalado: vuelve a la última partida de este dispositivo.
  location.replace(`/p/${last}`);
} else {
  // En producción el servidor ya redirige "/"; esto cubre el modo desarrollo.
  location.replace(`/p/${randomBase62(22)}`);
}
