import { randomBase62 } from './session.ts';
import { showStart } from './start.ts';
import './style.css';

/** Rutas: /p/<token> es una partida; cualquier otra crea una URL nueva. */
const m = location.pathname.match(/^\/p\/([0-9A-Za-z]{22})\/?$/);
if (m) {
  void showStart(m[1]!);
} else {
  // En producción el servidor ya redirige "/"; esto cubre el modo desarrollo.
  location.replace(`/p/${randomBase62(22)}`);
}
