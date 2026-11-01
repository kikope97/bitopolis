# Bitópolis — Especificación para Claude Code

> **Para Claude Code:** este archivo es todo el encargo. Léelo entero y empieza a construir el proyecto siguiendo la hoja de ruta (sección 14), versión a versión, sin esperar más instrucciones. Al terminar cada versión, haz commit y push a GitHub, comprueba que el CI publica la imagen y ejecuta la ronda de agentes (sección 13) antes de pasar a la siguiente. Copia este archivo en el repo como `docs/SPEC.md` y crea un `CLAUDE.md` con el resumen de la arquitectura, los comandos y las reglas.

---

## 1. Qué es

**Bitópolis** es un simulador de gestión de ciudad con estética **pixel art retro (8/16-bit)**, que se juega en el navegador. El jugador es el **alcalde** de un pueblo que empieza casi vacío: un ayuntamiento, un habitante que trabaja allí y una subvención inicial de la región. Su trabajo es hacerlo crecer.

Es un **experimento**: los habitantes con nombre son **agentes de IA (LLM)** que deciden por su cuenta (mudarse, trabajar, comprar casa, montar negocios, quejarse, votar). El jugador no controla a la gente: controla las reglas (impuestos, servicios, obras) y ve cómo reacciona el pueblo.

### Principio del experimento: la IA manda
El diseño lo deciden agentes de IA (revisores y playtesters simulados) y Claude elige qué se aplica. **Excepción:** las decisiones marcadas como *del creador* (secciones 2, 10, 11 y 12) son fijas y ninguna ronda de agentes puede cambiarlas.

## 2. Plataforma *(decisión del creador)*

- **Web app.** Prioridad: **móvil táctil** en vertical y horizontal. Debe funcionar también en escritorio (ratón y teclado), aunque no es la prioridad.
- PWA instalable (manifest + service worker para cachear assets). **No** se hacen apps nativas por ahora; iOS/Android quedan para el futuro (no usar Capacitor).
- Se instala con **una imagen Docker y un docker-compose** (sección 12).
- Idioma: **español**, con i18n preparada para añadir inglés.
- Proyecto personal, sin monetización.

## 3. Stack técnico

- **Monorepo TypeScript** con pnpm:
  - `packages/sim` — motor de simulación. TypeScript puro, **sin DOM ni red**, se ejecuta en Node y en un Web Worker.
  - `packages/client` — Vite + Canvas 2D (PixiJS solo si hace falta por rendimiento) para el mapa; UI en HTML/CSS.
  - `packages/server` — Node + **Fastify**: API, persistencia, llamadas a la IA y sirve el cliente compilado.
  - `packages/shared` — tipos, esquemas zod y comandos.
- Base de datos: **SQLite** (modo WAL) con Drizzle o Kysely, de forma que se pueda migrar a MariaDB sin reescribir.
- Las fronteras entre paquetes se imponen con lint (por ejemplo, `sim` no puede importar DOM ni `fetch`).
- Tests: Vitest (sim y servidor) y Playwright (UI en viewport móvil y de escritorio).

## 4. Arquitectura de la simulación

- **Determinista**: un único PRNG con semilla. En `sim` están prohibidos `Math.random()` y `Date.now()`.
- **Paso fijo**: 1 tick = 1 hora de juego. La velocidad solo cambia los ticks por segundo.
- **Tiempo**: 1 día de juego = **20 s reales a x1** (1 año ≈ 2 h; legislatura de 4 años ≈ 8 h a x1). Velocidades: pausa, x1, x3, x10. Los cobros (cuotas, alquileres, nóminas) se hacen a fin de mes.
- **Toda acción es un comando serializable** (`{type:'SetTax', ...}`), venga del jugador o de la IA. El motor valida y aplica. Semilla + lista de comandos reproduce cualquier partida.
- **La IA decide, el motor ejecuta**: el LLM nunca toca números directamente. Elige entre acciones válidas que calcula el motor, y el motor cuadra el dinero.
- Estado en **datos planos** (tablas por tipo, sin clases ni referencias circulares) con `formatVersion` y migraciones encadenadas, cada una con su test.
- **Dónde corre**: la simulación corre en el cliente, dentro de un Web Worker. Al cerrar cada día de juego, el cliente envía al servidor el estado y los comandos. El servidor guarda la partida y, en Modo IA, devuelve las decisiones de los agentes para el día siguiente (sección 9). El servidor es la fuente de verdad de la partida.
- **CLI headless**: `pnpm sim --seed 42 --days 365 --profile <perfil> --out report.json`. Genera métricas: población, felicidad, presupuesto, quiebras, dinero descuadrado y eventos. Los perfiles son estrategias automáticas de jugador (casual, ahorrador, agresivo con los impuestos, constructor…).
- **Invariantes en CI**: el dinero se conserva (salvo entradas y salidas explícitas), nada baja de cero sin deuda, la misma semilla da el mismo hash de estado, y hay snapshots golden del día N.
- En los tests de IA se usa un `ReplayProvider` con respuestas grabadas: cero llamadas de red y siempre el mismo resultado.

## 5. Mecánicas de juego (alcance hasta la v1.0)

### 5.1 Mapa y construcción
- Mapa de casillas de **32×32** (decisión del creador, ronda 01) en vista cenital 3/4 (no isométrica), con tamaño finito (el suelo es un recurso limitado).
- **Carreteras, agua y electricidad** como redes conectadas. Los servicios cubren por radio.
- **Zonas RCI** (residencial, comercial, industrial) con un **indicador de demanda** que guía qué construir.
- **Externalidades**: contaminación (la industrial es persistente), ruido, delincuencia y valor del suelo, que se propagan por el mapa.
- **Capas de datos** superpuestas: felicidad, valor del suelo, cobertura de servicios y contaminación (con leyenda y patrones, no solo color).

### 5.2 Obras y mano de obra
- Cada obra necesita obreros y días (por ejemplo, una casa necesita 5 obreros durante X días).
- Si no hay obreros locales libres, se contratan **obreros de fuera**, más caros. **El pueblo nunca se queda bloqueado.**
- Las obras tienen una barra de progreso y la opción "avísame cuando acabe".

### 5.3 Servicios municipales
Agua, luz, basuras, policía, bomberos, centro de salud, colegio, parque, piscina (cuota mensual), polideportivo, mercado y, más adelante, parque de atracciones.
Cada uno tiene: coste de construcción, mantenimiento mensual, empleados necesarios, capacidad, ingresos (si cobra entrada o cuota), efecto en la felicidad y radio.

### 5.4 Ingresos del ayuntamiento (inspirados en un ayuntamiento español real)
- Al principio hay **un único control de impuestos** (bajo/medio/alto).
- A partir de 50 vecinos se desbloquean por separado: **IBI** (vivienda), **tasas** (basuras y terrazas) y **plusvalía municipal** (sobre las compraventas).
- **PIE**: el Estado aporta dinero según la población empadronada, así que crecer da dinero.
- Subir impuestos sube los ingresos a corto plazo, pero baja la felicidad y el consumo y aumenta la emigración. Cada tributo afecta a un grupo de vecinos distinto.
- La felicidad tiene **inercia**, y los agentes recuerdan las subidas de impuestos: bajarlos justo el año de las elecciones no borra lo anterior.
- Todas las siglas tienen un glosario a un toque, con una frase sencilla ("sube tu dinero y baja la felicidad de los propietarios").

### 5.5 Vivienda y propiedad
- **Pública**: si la construye el ayuntamiento, es municipal. Si la vende, el dinero va al ayuntamiento, y también puede alquilarla.
- **Privada**: si la compra o la construye un vecino, es suya. Si la revende, el dinero es para el vecino y el ayuntamiento cobra la plusvalía.
- Los precios dependen de la oferta, la demanda y la calidad del barrio.
- Contra la especulación: la vivienda municipal tiene coste de transacción y precio máximo, y la especulación penaliza la felicidad y el voto.

### 5.6 Empresas
- Las crean los vecinos (una tienda de ropa, una panadería). El motor comprueba que tienen dinero, local y empleados.
- Las empresas pagan sueldos, venden a los vecinos y pagan impuestos, y pueden quebrar.

### 5.7 Progresión por población

| Vecinos | Se desbloquea | Presión principal |
|---|---|---|
| 1–10 | casa, carretera, agua, luz | dinero y vivienda |
| 10–50 | zonas RCI, impuesto único, primeros servicios | dinero y vivienda |
| 50–200 | tributos separados, más servicios, plenos, consejero | felicidad y facciones |
| 200+ | facciones, elecciones, oposición | elecciones |

*Ronda 06:* facciones y oposición se activan con **50** vecinos (con 200 casi ningún pueblo llegaba a tenerlas en 4 años); las elecciones son cada 4 años desde el principio.

- Siempre hay 1–3 **objetivos** visibles con recompensa ("llega a 10 vecinos"), y cada fase tiene un hito con recompensa tangible (un edificio o una herramienta).
- **Parte mensual**: ingresos y gastos con flechas, y un "por qué baja tu saldo" con nombres.

### 5.8 Elecciones (v1.0)
- Cada 4 años de juego. Los vecinos con IA votan según su experiencia, y la población estadística según la felicidad de su barrio y facción.
- **Facciones** (jubilados, jóvenes, empresarios, ecologistas) con exigencias opuestas.
- Avisos de popularidad con antelación.
- **Oposición emergente**: un vecino influyente puede fundar un partido y presentarse. Si gana, el jugador pasa a la **oposición**: sigue viendo el pueblo y vuelve a presentarse en las siguientes elecciones. No hay game over.

## 6. Habitantes

### 6.1 Población
- Hasta **20 vecinos con nombre** (configurable) con IA. El resto es **población estadística** que sigue la media real de su barrio y su facción.
- En Modo normal, los vecinos con nombre deciden con reglas y plantillas narrativas deterministas variadas, para que el juego no se sienta vacío.

### 6.2 Ficha de cada vecino
Nombre, edad, profesión, dinero, casa, trabajo, rasgos de personalidad numéricos y fijos (incluido un rasgo de "terquedad o irracionalidad"), necesidades, felicidad, **deseo** y **miedo** concretos, meta personal, **relaciones** con nombre (amistad, rivalidad, pareja, rencor) y memoria.

### 6.3 Decisiones posibles (enum cerrado)
Mudarse al pueblo o no, irse y vender la casa, comprar o alquilar casa, buscar o cambiar de trabajo, gastar en ocio, fundar una empresa, contratar o despedir (si es empresario), quejarse o pedir algo en un pleno, votar.

## 7. Herramientas del alcalde

- **Lista de vecinos** y una ficha detallada al tocar a cualquiera (qué hace, su dinero, sus preocupaciones, sus relaciones).
- **Hablar con un vecino** usando solo preguntas predefinidas: "¿cómo estás?", "¿qué necesitas?", "¿me votarías?".
- **Pleno municipal**: se convoca cuando se quiere, pero tiene un coste. Los vecinos exponen quejas y peticiones y se vota. Las **promesas quedan registradas**, y si no se cumplen castigan a la facción afectada.
- **Consejero (IA)**: responde a "¿cómo va el pueblo?" y "¿qué cambiarías?" con los datos reales. En Modo normal, da consejos por reglas.
- **Diario del pueblo**: crónica de lo que pasa, con la voz de los vecinos.
- **Resumen al volver**: "Mientras no estabas: +3 vecinos, Lucía abrió una panadería, se quejan del agua".
- **Las decisiones tienen cara**: al aplicar una medida, se muestra a quién afecta, con nombre.
- Panel de estadísticas con gráficas propias en pixel art.

## 8. Interfaz, arte y accesibilidad

### 8.1 Arte (todo propio, generado por código)
- **Paleta cerrada de 64 colores** en `palette.ts` (decisión del creador, ronda 04: antes 32), validada en el build: si aparece un color fuera de la paleta, el build falla.
- **Alta definición** (decisión del creador, ronda 01): pixel art detallado, no "de cuadros". Casillas de 32 px y edificios de 32×48 que sobresalen hacia arriba, con texturas (ladrillo, tejas, chapa), reflejos, sombras proyectadas y tramado.
- Sprites a partir de **plantillas modulares** (base, tejado, puerta, ventanas) en matrices de índices de paleta. Se combinan con semilla y se exportan a un atlas en el build. Luz desde arriba a la izquierda, contorno de 1 px de color (no negro), 4–5 tonos por material, sin degradados ni antialiasing.
- **Aún más definido y animado** (decisión del creador, ronda 04): más detalle por sprite y animaciones por fotogramas: vecinos caminando, agua y humo que se mueven, árboles con viento, obras con andamios, luces que se encienden de noche. Todo respeta el modo calma y `prefers-reduced-motion`.
- Vecinos de 12×18 px con silueta propia e icono de estado encima.
- Escala entera con `image-rendering: pixelated` y zoom en múltiplos enteros.
- Nada de assets de terceros.

### 8.2 Feedback
- Squash & stretch al construir, partículas y monedas que vuelan al contador. Vibración con `navigator.vibrate` donde exista, desactivable.
- Sonido sintetizado propio (WebAudio, estilo jsfxr) con variación de tono, ambiente según la hora del día y mute separado para música y efectos.

### 8.3 Controles
- **Táctil**: seleccionar herramienta y tocar el mapa, arrastrar para mover, pellizcar para hacer zoom (sin saltos), más botones +/− de zoom. Nada importante con pulsación larga.
- **Escritorio**: clic, arrastrar, rueda para el zoom y atajos de teclado básicos.
- UI en paneles inferiores (bottom sheets) al alcance del pulgar. Botones principales de 48–56 px.
- Las acciones caras o irreversibles (demoler, préstamos) piden confirmación.

### 8.4 Accesibilidad
- Fuente bitmap propia como opción estética, más una **fuente legible** (sans-serif, ≥16 px) y tamaño de texto al 100/150/200%, independiente del zoom.
- El color nunca es la única señal. Modos para daltonismo, contraste WCAG AA validado y modo de alto contraste.
- **Modo tranquilo** (x1, pausa automática en eventos importantes) y avisos sin tiempo límite.
- Tutorial guiado de unos 3 minutos (una flecha señala qué tocar; primero carretera, luego agua y luz), repetible desde el menú, y botón **"¿Qué hago ahora?"**.
- Respeta `prefers-reduced-motion`. La UI HTML se puede usar con lector de pantalla.

## 9. IA de los habitantes

### 9.1 Cuándo se llama a la IA
- **Solo cuando hay un detonante**: despido, subida del alquiler, oferta de trabajo, casa en venta, pleno, conflicto detectado. No se llama a todos los vecinos cada día.
- Las decisiones se agrupan por lotes y se **piden con un día de antelación** (al cerrar el día N se piden las del N+1). La simulación nunca espera a la IA: si una respuesta no llega a tiempo, ese vecino decide por reglas.
- Las rutinas (ir a trabajar, comer) son siempre reglas.
- **Cero llamadas** en pausa, con la pestaña oculta o sin conexión. El tiempo ausente no se simula con IA.

### 9.2 Formato
- El motor calcula las **acciones válidas** de cada vecino y las pasa como `enum` en un JSON Schema estricto (salida estructurada), con un campo `motivo` corto en primera persona.
- La respuesta se valida con zod. Si no es válida, se reintenta una vez y después se usa la regla de fallback.
- Temperatura baja. Cada respuesta se guarda en el **log de decisiones** de la partida (compactado con el tiempo).
- **Prompt caching**: primero el prefijo fijo (reglas, esquema, estado del pueblo) y al final lo variable.
- **Nunca se pasa texto libre del jugador al LLM** (nombres de calles, peticiones…): solo enums y números del motor, para evitar prompt injection.

### 9.3 Memoria e historias
- Memoria en 3 capas, cada una con límite de tokens: hechos estructurados (relaciones, deudas, metas, promesas), unos pocos recuerdos por importancia y un resumen narrativo que se reescribe cada mes de juego.
- **Director de historias** (determinista): detecta ganchos (dos vecinos quieren el mismo local, alguien pierde el trabajo y tiene hipoteca) y los inyecta en el prompt. Sus eventos varían con la semilla para que no compense guardar y recargar.
- Control de calidad: se penalizan los motivos repetidos y se comprueba que cada decisión encaja con la ficha del vecino.
- *(v1.3)* Cada gancho termina con un **desenlace** en el diario y un recuerdo (salir adelante, pasar página, hacer las paces, volver a confiar). Plazas, mercados y parques crean amistades entre vecinos cercanos. Cada vecino lleva un **tono** sacado de sus rasgos, y se descartan los textos que nombran a personas que no están en los datos.
- **Momento "wow" en los primeros 10 minutos**: el 3.er vecino toma una decisión visible, con su `motivo` en una burbuja.

### 9.4 Modelos y proveedores
- Dos niveles de modelo: **barato** para las decisiones diarias y **premium** para plenos, consejero y diario.
- Proveedores: OpenAI, Anthropic, Gemini, DeepSeek, Mistral, OpenRouter y cualquier **endpoint compatible con OpenAI** (Ollama, LM Studio).
- Al implementarlo, consulta la documentación actual de cada proveedor para elegir los modelos por defecto y los precios de la tabla, y deja la tabla editable.

### 9.5 Coste
- Antes de jugar, el juego muestra una **estimación de coste** en €/hora según el modelo, el número de vecinos y la velocidad.
- **Topes en euros** por día y por mes de cada partida, y por mes de todo el servidor, con avisos al 50% y al 80%. Al llegar al tope hay un **corte duro**: el juego pasa a reglas y lo indica en pantalla.
- Un pleno o una crónica **reserva su presupuesto antes de empezar**: si no alcanza, no empieza, para no quedarse a medias.
- Aviso al poner x10 con la IA activa.
- Panel de gasto desglosado por uso (decisiones, plenos, consejero, diario).
- Pantalla **"Qué se envía"** con un ejemplo real de prompt. Sin telemetría.

### 9.6 La superIA del pueblo (v2.0, pedido por el creador)
- En Modo IA, el pueblo decide **por turnos semanales** (2 a x3, 4 a x10): todos los vecinos con IA a la vez, por lotes de 15 con un bloque común cacheado. Cada vecino elige una acción de su menú (también las económicas: trabajo, negocio, mudanza, dónde gasta), un gesto social, su actitud hacia el alcalde, un plan o ultimátum, un pensamiento y una nota de su semana. Lo que no vale lo decide el motor; sin respuesta, la costumbre (reglas). Reacción rápida tras una medida gorda.
- **% de vecinos con IA** (0–100, por defecto 50): en `/admin` con la IA del servidor; en Ajustes de la partida con key propia. Al subirlo solo se añaden.
- **Director del pueblo**: elige qué sucesos reales pasan (robos, asociaciones, manifestaciones, peleas, reconciliaciones, ayudas, gratitud, rumores, mitin de la oposición, historias), con presupuesto de drama según el descontento, aviso previo de todo lo malo y topes al mes. Escribe el foco y la crónica de la semana.
- **Gasto**: «Calidad» (modelo bueno) o «Ahorro»; al 70 % de un tope baja solo al barato y el director va un turno sí y otro no; en el tope, reglas.
- El juego no se adelanta al turno: espera hasta 45 s a la IA («El pueblo está pensando…»).
- Plan completo: `docs/propuestas/v2.0-superia.md`.

## 10. Partidas y pantalla de inicio *(decisión del creador)*

### 10.1 Partida por URL (sin cuentas)
- **No hay cuentas de usuario.** Cada partida se identifica por un token en la URL: `/p/<token>`, aleatorio de ≥128 bits (base62, ~22 caracteres).
- Al entrar en `/`, se redirige a una URL nueva `/p/<token>`. La partida se guarda en la base de datos cuando se pulsa **Jugar** o se guarda la configuración, no antes, para no llenar la BD de partidas vacías.
- Quien tiene la URL tiene la partida: **la URL funciona como una contraseña**. Se avisa ("guarda este enlace y no lo publiques") y hay un botón para **regenerar el enlace**, que invalida el anterior.
- Guardado automático en el servidor al cerrar cada día de juego y al salir. Si la misma partida se abre en dos sitios, solo uno puede jugar y el otro ve un aviso de "partida abierta en otro dispositivo".
- **Exportar/Importar** un archivo `.bitopolis` (JSON comprimido con `formatVersion`) como copia de seguridad. El archivo **nunca incluye la API key**. Al importarlo se crea una partida nueva con una URL nueva.

### 10.2 Pantalla de inicio
- Botón grande **Jugar** (o **Continuar** si la partida existe). Si existe, muestra **mini estadísticas**: población, fecha, dinero, felicidad y el último titular del diario. Si es nueva, no muestra nada.
- Arriba, un botón **Configurar**.
- Selector de **modo**:
  - Sin API configurada: se ven **Modo normal** y **Modo IA**. Al pulsar Modo IA se abre la configuración de la IA (proveedor, modelo, key y topes de gasto).
  - Con la IA configurada en el panel `/admin`: **se siguen viendo los dos modos**. Modo IA no pide nada: usa la IA del servidor. *(Decisión del creador, v1.3.1; antes solo se veía Modo IA.)*
- **El modo se elige antes de empezar y queda fijo** para toda la partida.
- Flujo previsto: el creador configura la IA en `/admin` y pasa el enlace a sus amigos. Cada uno elige Modo normal o Modo IA y juega sin configurar nada.

## 11. API key y seguridad *(decisión del creador)*

- La key se guarda en la base de datos, **asociada a la partida** (o, la del servidor, en los ajustes de `/admin`), cifrada con AES-256-GCM. La clave maestra se genera sola la primera vez en `/data/secret.key` (permisos 600), nunca en la BD.
- **Todas las llamadas a la IA las hace el servidor.** La key nunca vuelve al cliente: en Configurar solo se ve `sk-…abcd`. Nunca aparece en logs, exportaciones ni respuestas de la API.
- Al guardar la key aparece un **aviso que hay que aceptar** con una casilla: "Pon un límite de gasto en el panel de tu proveedor. Bitópolis es un proyecto personal y no se hace responsable si la key se filtra o se usa de más."
- Los topes de gasto se aplican en el servidor, porque cualquiera con la URL usa la key.
- CSP estricta, sin scripts de terceros. Rate limiting en la API.

## 12. Instalación, Docker y CI *(decisión del creador)*

### 12.1 Instalación
- Se instala con **una imagen Docker y un `docker-compose.yml`** que el usuario copia y pega en Portainer (Stacks) o arranca con `docker compose up -d`. No hay pasos manuales.
- La imagen incluye el servidor, el cliente compilado y las migraciones de SQLite, que se aplican solas al arrancar.
- Los datos se guardan en el volumen `/data`: `bitopolis.db` y copias diarias automáticas con rotación.
- Endpoint `/healthz` para el healthcheck.
- Pensada para ir detrás de un proxy inverso con HTTPS. Debe funcionar también por HTTP en una LAN, avisando de que es inseguro.
- En el repo: `Dockerfile` multi-stage y un `docker-compose.yml` de ejemplo **sin variables**. El `README.md` explica la instalación en 5 líneas.

### 12.2 Panel de administración, sin variables de entorno *(decisión del creador, v1.2, octubre de 2026)*

Sustituye a la tabla de variables de entorno anterior (`BITOPOLIS_MASTER_KEY`, `BITOPOLIS_PUBLIC_URL`, `BITOPOLIS_PASSWORD`, `BITOPOLIS_API_KEY`, `BITOPOLIS_AI_*`, `BITOPOLIS_BUDGET_*`). La imagen Docker **no pide ninguna variable**; todo se configura en **`/admin`** y los cambios valen al momento.

- **Acceso:** usuario y contraseña propios del panel; la primera vez, **`admin` / `admin`**, y el panel obliga a cambiar la contraseña antes de dejar configurar nada. Contraseñas con scrypt, cookie `HttpOnly`/`SameSite=Strict`, bloqueo tras 5 fallos, sesión de 12 h. Contraseña olvidada: archivo `/data/reset-admin` y reiniciar.
- **Partidas y acceso:** URL pública para los enlaces (en blanco, la del navegador); permitir o no partidas nuevas (si no, no se crean ni importan, y las existentes siguen); contraseña común para jugar, activable y **solo contraseña, sin usuario** (decisión del creador anterior, que se mantiene).
- **IA:** API key del servidor (el proveedor se sigue deduciendo de la key: `sk-ant-…` Anthropic, el resto OpenAI), modelo y modelo premium, endpoint propio, vecinos con IA (1–20), topes (servidor/mes, partida/mes, partida/día), tabla de precios, si cada partida puede poner su propia key, y «Probar la IA».
- **Partidas** (lista, exportar, borrar), **copias** (cuántas se guardan, hacer una ahora, descargar) y **cuenta** del panel.
- **Clave maestra:** se genera sola en `/data/secret.key`. Copiar `/data` entera basta para mover el servidor.
- Solo quedan ajustes internos fijados en la imagen: `PORT`, `BITOPOLIS_DATA_DIR`, `BITOPOLIS_CLIENT_DIR`, `BITOPOLIS_VERSION` (y `LOG_LEVEL` para depurar).

**Regla:** lo que se fija en `/admin` manda y en Configurar aparece en solo lectura, como "definido por el servidor". Lo que no se fija se puede configurar por partida.

### 12.3 Repositorio y CI
- Código en **GitHub**, en un repo llamado `bitopolis`. Si no existe, créalo con `gh` como privado. Haz commits pequeños y frecuentes con mensajes claros.
- **GitHub Actions**:
  - En cada push y en cada PR: lint, typecheck, tests, invariantes de la simulación (365 días con varias semillas) y Playwright.
  - En cada push a `main`, si todo pasa: build multi-arquitectura (`linux/amd64` y `linux/arm64`) y publicación en GHCR como `ghcr.io/${{ github.repository_owner }}/bitopolis:test` y `:sha-<commit>`.
  - Con un tag `vX.Y.Z`: publica `:X.Y.Z` y `:latest`.

## 13. Proceso de trabajo con agentes (el experimento)

Al cerrar cada versión de la hoja de ruta:

1. **Playtest con métricas**: ejecuta `pnpm sim` con varios perfiles y semillas. Mide la población a 1 año, el % de partidas que quiebran, que ninguna estrategia rinda más de 2x que las demás, el tiempo hasta el primer objetivo y el coste de la IA por mes de juego (con el `ReplayProvider` o con una key de pruebas si existe).
2. **Playtest de la interfaz**: Playwright recorre el juego en viewport móvil y de escritorio y hace capturas.
3. **Ronda de agentes**: lanza entre 4 y 6 subagentes con perfiles distintos (jugador casual de móvil, veterano de city builders, min-maxer, jugador mayor/accesibilidad, interesado en la IA y las historias, y una reseña de "público" simulando que el juego ya está publicado). Cada uno recibe la spec, las métricas y las capturas, y devuelve como máximo 8 recomendaciones.
4. **Decisión**: Claude elige. Cada ronda acepta **como máximo 5 cambios** y debe **quitar o aplazar al menos uno**. Las decisiones del creador (secciones 2, 10, 11 y 12) no se tocan. Las reseñas sin métricas que las respalden no deciden nada por sí solas.
5. Registra la ronda en `docs/rondas/ronda-XX.md` (métricas, recomendaciones, qué se acepta, qué se rechaza y por qué) y actualiza `docs/SPEC.md`.

## 14. Hoja de ruta

El alcance está congelado hasta la v1.0. Todo lo de la sección 15 solo entra si una ronda lo justifica con métricas.

- **v0.0 — Esqueleto**: monorepo, lint de fronteras, `sim` con PRNG, ticks y comandos, `pnpm sim`, invariantes, Fastify sirviendo el cliente, SQLite con migraciones, Dockerfile, compose de ejemplo, GitHub Actions publicando `:test`, Playwright en viewport móvil, `CLAUDE.md`.
  *Hecho cuando:* el CI está en verde, 365 días simulados tardan menos de 10 s, y `docker compose up` arranca y responde en `/healthz`.
- **v0.1 — Pueblo jugable (Modo normal)**: pantalla de inicio, partida por URL, guardado en el servidor, exportar/importar, mapa, carreteras, agua y luz, zonas RCI con demanda, impuesto único, 3 servicios, obras con obreros, tutorial, controles táctiles y de escritorio, `BITOPOLIS_PASSWORD`.
  *Hecho cuando:* se juega 15 minutos en el móvil sin quedarse bloqueado, y el CLI muestra que el pueblo puede crecer y también quebrar.
- **v0.2 — Prueba de la IA**: configuración de la IA, key cifrada, variables de IA, proveedores, 5 vecinos con nombre, detonantes, enums y zod, petición anticipada, fallback, topes y estimación de coste, `ReplayProvider`, burbujas con `motivo`.
  *Hecho cuando:* el coste por mes de juego está medido, ≥98% de las respuestas son válidas o se resuelven con fallback, y los `motivo` tienen personalidad. **Si no se cumple, se replantea la IA antes de seguir.**
- **v0.3 — Economía**: vivienda pública y privada con compraventa entre vecinos, empleo, empresas creadas por vecinos, IBI, tasas, plusvalía y PIE, felicidad con inercia, externalidades y capas de datos, parte mensual, 20 vecinos con nombre y población estadística.
- **v0.4 — Social**: fichas completas (deseo, miedo, relaciones), memoria en 3 capas, director de historias, plenos con promesas, consejero, hablar con vecinos, diario, resumen al volver, objetivos e hitos.
- **v0.5 — Pulido**: arte final, sonido y feedback, accesibilidad completa, rendimiento en móviles de gama media, PWA.
- **v1.0 — Elecciones**: facciones, elecciones, oposición emergente y avisos de popularidad.
- **v1.1 — Oposición jugable y pulido** (ronda 07). **v1.2 — Panel `/admin`** sin variables de entorno (ronda 08).
- **v1.3 — Historias, política e interfaz** (ronda 09):
  - desenlaces de los ganchos y amistades de barrio;
  - registro del gobierno rival, cuenta atrás y pregunta de la oposición en el pleno;
  - servicios con capacidad: colegio 60, centro de salud 80 y comisaría 120 vecinos;
  - tono por vecino y filtro de nombres inventados;
  - farolas y skyline animado.

- **v1.4 — Auditoría táctil** (ronda 10): obras con confirmación en táctil, dock único, menú sin bucle, x10 jugable, mapa al 77–85 % de la pantalla.

- **v1.5 — Ayuntamiento y ciclo vital** (ronda 11): presupuesto anual votado, fiestas del pueblo, subvenciones con plazo y cofinanciación, y ciclo vital (nacimientos, herencias y fallecimientos). Pedido por el creador, del backlog §15.
- **v1.6 — Rediseño de la interfaz** (ronda 12): revisión crítica en cinco tamaños (iPhone mini, 17, 17 Pro Max, Android 360 px con horizontal, iPad). Barra de datos arriba, franja de contexto, cinco pestañas con bandeja «Construir» por categorías, panel «Pueblo», avisos en una línea con campana, fichas a media pantalla y panel lateral en tableta y horizontal.
- **v1.7 — Geografía y vida** (ronda 13): río, costa, colinas y puentes; estaciones y tiempo (nieve, calor, tormentas y riadas); bar, ermita, cementerio, biblioteca y polideportivo; asociaciones vecinales y manifestaciones; álbum del pueblo y árbol genealógico; capa «Qué falta» por vivienda (propuesta del creador).
- **v1.8 — Ayuntamiento, delincuencia y animaciones** (ronda 14, pedido por el creador): el ayuntamiento sube de nivel (1–5) y desbloquea zonas, plenos y edificios junto con la población; los servicios suben a nivel 2 y 3 (más alcance y capacidad, con requisitos de ayuntamiento, vecinos y uso, y mejor aspecto); panel «Gestión del pueblo» a pantalla completa al tocarlo; robos en tiendas, comisarías con calabozos limitados y cárcel; manifestaciones que crecen y acaban en disturbios que destrozan tiendas (se pagan para repararlas); todo animado (marcha con pancartas, policía, ladrón); calendario a x3/x10 y vuelta a x1 con temblor y destello cuando algo pide atención; ficha de casa con servicios y vecinos; número de versión en Ajustes.

- **v1.9 — Economía de cada vecino** (ronda 15, pedido por el creador): balance y deudas de cada vecino (impuestos, alquiler, hipoteca, multas), desahucios y embargos, paro real con prestación, sueldo mínimo para las empresas con su efecto en trabajadores y empresarios, salud de las empresas, aplazar o perdonar deudas y microcréditos, robos en casas y ladrones del propio pueblo, capa «Bolsillo de los vecinos». Ver `docs/propuestas/v1.9-economia-personal.md`.

- **v2.0 — La superIA del pueblo** (ronda 16, pedido por el creador): turnos semanales con IA para un % de vecinos, decisiones económicas por lotes, director del pueblo con presupuesto de drama, notas y contagio de actitud, modelos desde la API key y escalera de gasto. Ver §9.6.

- **v2.1 — Emergencias y encargos** (ronda 17, pedido por el creador): bomberos e incendios con aviso previo, protección civil y diques, ambulancia, basura y punto limpio, encargos del pueblo, El Eco de Bitópolis, rangos de aldea a capital comarcal con escudo, «Mientras no estabas».
- **v2.2 — Economía y política** (ronda 18): préstamos con nota A–D, licitaciones con la oferta del primo y escándalo, calles con nombre, el campo con cosechas, rival con estilo y promesas, varias candidaturas, biografías y pies de foto con IA y el gobierno del rival con IA. Siguientes versiones: `docs/propuestas/hoja-de-ruta-2.x.md`.
- **v2.3 — Metas grandes** (ronda 19): grandes obras 2×2 por fases (puente, estación, feria, estadio, catedral) con cofinanciación de la Diputación y FEDER, la comarca con bonanzas y crisis y la gran empresa (ERE incluido), turismo con patrimonio, tasa, casas rurales y entorno protegido, escenarios (quiebra, vaciado, riada) y terrenos, historia con gráficas, récords y 36 medallas, y compartir el pueblo con un enlace de solo lectura y una postal (sin contraseña: decisión del creador). La IA dona, abre casas rurales, se queja de los turistas y el director narra voluntarios, polémicas, reportajes, EREs y contrataciones.
- **v2.4 — Vida** (ronda 20): guardería y residencia con cuotas y pensión mínima, estación de autobuses con billete, el río que se ensucia aguas abajo con depuradora, placas y molinos, plenos hablados por la IA con reacción del público, dilemas morales con opciones del motor y fiestas de temporada (romería, San Juan, patronales y Navidad) con comisión de festejos. Siguiente: 2.5 «Comarca».

## 15. Después de la v1.0 (backlog, no implementar antes)

Deuda municipal con límites reales y calificación crediticia; presupuesto anual votado; subvenciones con plazo y cofinanciación; funcionarios y externalización; PGOU y licitaciones; dificultad "Interventor" con toda la burocracia; sindicatos, asociaciones (hechas en la v1.7) y huelgas; ciclo vital (nacimientos, herencias, muertes); cultura y fiestas inventadas por los vecinos; ciudades vecinas con alcalde IA y migración entre ellas; presidencia de varias ciudades; contenido nuevo propuesto por los agentes (como JSON validado y probado con `pnpm sim`); tarjetas compartibles y álbum del pueblo; visitar pueblos de amigos en solo lectura; árbol genealógico; mapas con terreno; modo acuario (el alcalde también es una IA); apps nativas de iOS y Android.

## 16. Nombre

**Bitópolis**. En una búsqueda web de octubre de 2026 no apareció ningún juego con ese nombre (sí nombres parecidos: Bitopoly, Bitropolis, Bit City). Antes de publicarlo en abierto hay que comprobar las marcas en TMview/OEPM (clases 9 y 41) y el dominio.
