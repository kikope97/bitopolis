# Ronda 08 — cierre de la v1.2 (panel /admin)

## Qué trae la v1.2

- **Sin variables de entorno** (decisión del creador). El `docker-compose.yml` solo tiene la imagen, el puerto y el volumen. Todo se configura en **`/admin`** y vale al momento:
  - URL pública, partidas nuevas y contraseña para jugar;
  - IA del servidor: key, modelos, endpoint, vecinos, topes, precios, keys propias y «Guardar y probar»;
  - partidas, copias y cuenta.
- **Primer acceso** con `admin` / `admin` y **cambio obligatorio** antes de poder configurar nada. Contraseñas con scrypt. Si se olvida: `/data/reset-admin`.
- **Clave maestra generada** en `/data/secret.key` (0600). Como no había instalaciones, no hay migración de las variables antiguas.
- La fuente pixel sale idéntica en cada build (antes cambiaba la fecha y ensuciaba git).

## Métricas

El motor no cambia en esta versión (sin diferencias en `packages/sim` ni `packages/shared`): valen las de la ronda 07. Comprobado con `pnpm sim --seed 42 --days 365 --profile casual` e invariantes en verde.

Pruebas:
- 124 tests unitarios (19 nuevos del panel y la seguridad);
- 36 e2e, con `e2e/admin.spec.ts` en su propio servidor.

## Agentes

1. **Seguridad.** Encontró **dos fallos críticos**:
   - `/api/%61dmin/…` se saltaba el login del panel, porque se comparaba la URL sin decodificar;
   - con key del servidor, una partida podía poner su endpoint y recibir la key.

   Además:
   - la IP del bloqueo se falseaba con `X-Forwarded-For`;
   - el usuario se podía adivinar por el tiempo de respuesta;
   - las cookies de juego revivían al reactivar la contraseña;
   - salir del panel no revocaba la sesión.
2. **Instalador no técnico (NAS + Portainer):**
   - «Probar la IA» probaba lo guardado, no lo escrito;
   - no sabía qué enlace mandar a sus amigos;
   - los topes vienen vacíos;
   - cómo mover el volumen.
3. **UX móvil y accesibilidad:**
   - se perdía el foco al redibujar o borrar;
   - errores sin asociar al campo;
   - contraseña dependiente siempre activa;
   - cuatro botones «Guardar» iguales;
   - toasts encima del formulario;
   - objetivos táctiles pequeños;
   - panel largo en móvil.
4. **Jugador amigo:**
   - la pantalla de contraseña no explica nada;
   - expulsión sin aviso al caducar;
   - aviso de partidas cerradas sin salida;
   - Modo IA que desaparece sin explicación;
   - enlace con otra dirección.

## Fallos de seguridad (arreglados todos, fuera del cupo de cambios)

- Los permisos se deciden con el patrón de la ruta ya resuelta (`req.routeOptions.url`), no con `req.url`.
- Con key del servidor, el endpoint queda bloqueado para las partidas.
- `trustProxy` solo para proxies de la red local (loopback, link-local y privadas).
- scrypt siempre y comparación del usuario en tiempo constante.
- Épocas de sesión: cambiar el acceso invalida las cookies de juego; salir del panel cierra todas sus sesiones.

Cada uno tiene su test en `admin.test.ts` («ronda 08: seguridad»).

## Cambios aceptados (5)

1. **«Guardar y probar»:** prueba la IA con lo que hay escrito.
2. **«Invitar a tus amigos»** en Partidas y acceso: el enlace raíz con botón Copiar y el aviso de no compartir `/p/…`.
3. **Textos para jugadores:**
   - la pantalla de contraseña explica a quién pedirla;
   - aviso de sesión caducada;
   - aviso de partidas cerradas con salida;
   - «El Modo IA no está disponible en este servidor».
4. **Accesibilidad del panel:**
   - foco al título de la tarjeta tras redibujar y al siguiente «Borrar»;
   - ayuda enlazada con `aria-describedby`;
   - errores con `aria-invalid` junto al campo;
   - contraseña para jugar desactivada sin la casilla;
   - botones con nombres distintos.
5. **Toasts del panel abajo a la derecha** y enlaces de partida de 44 px. README: volumen de Portainer, carpeta del NAS y qué incluye la copia descargada.

## Quitados o aplazados

- **Aplazado: tope del servidor relleno por defecto.** Es dinero del creador; mejor una estimación de coste junto a los topes (pendiente de la v1.3, «estimación de coste con reintentos»).
- **Rechazado: bind mount en el compose por defecto.** Las rutas relativas en Portainer dependen de dónde guarda el stack; se queda el volumen con nombre y el README explica la alternativa.
- **Aplazado: panel plegable o con índice en móvil** (unas 7 pantallas). Se revisará si crece.
- **Rechazado: ocultar «Configurar» con partidas cerradas**, porque también lleva a los ajustes del dispositivo.
- **Aplazado: nota cuando el enlace copiado no coincide con la barra del navegador.**
