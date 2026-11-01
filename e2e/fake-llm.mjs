// Servidor LLM falso, compatible con OpenAI, para las pruebas de Playwright.
// Elige la primera acción de cada vecino y responde con un motivo fijo.
import { createServer } from 'node:http';

const port = Number(process.env.FAKE_LLM_PORT ?? 8099);
createServer((req, res) => {
  // Lista de modelos (desplegables de /admin y Configurar), como la de OpenAI.
  if (req.method === 'GET' && req.url?.startsWith('/v1/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        object: 'list',
        data: [
          { id: 'falso-mini', object: 'model', created: 1_790_000_000, owned_by: 'bitopolis' },
          { id: 'falso-grande', object: 'model', created: 1_780_000_000, owned_by: 'bitopolis' },
          { id: 'falso-viejo', object: 'model', created: 1_700_000_000, owned_by: 'bitopolis' },
        ],
      }),
    );
    return;
  }
  if (req.method === 'GET') {
    res.writeHead(200).end('ok');
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const data = JSON.parse(body || '{}');
    const userText = (data.messages?.[1]?.content ?? '').split('\n\n')[0];
    let parsed;
    try {
      parsed = JSON.parse(userText);
    } catch {
      parsed = {};
    }
    // «Probar la IA» del panel /admin.
    if (userText.startsWith('Devuelve {"ok"')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '{"ok": true}' } }], usage: { prompt_tokens: 20, completion_tokens: 5 } }));
      return;
    }
    // 2.0: turno del pueblo (bloque común + «Lote de vecinos»).
    const whole = data.messages?.[1]?.content ?? '';
    // 2.0: director del pueblo: avisa de lo primero del menú y hace pasar lo bueno que haya.
    const dir = whole.indexOf('Director de la semana');
    if (dir >= 0) {
      const d = JSON.parse(whole.slice(whole.indexOf('\n', dir) + 1));
      // 2.3: lo bueno de las metas grandes primero (voluntarios, reportaje, contrata), si lo hay.
      const goals = ['voluntarios_obra', 'reportaje_tv', 'contrata_vecinos'];
      const good = [...d.menu.filter((m) => !m.malo && goals.includes(m.tipo)), ...d.menu.filter((m) => !m.malo && !goals.includes(m.tipo))].slice(0, 1);
      const out = {
        sucesos: [...good, ...d.menu.filter((m) => m.malo && m.avisado).slice(0, d.presupuesto_drama.sucesos_malos_que_caben)].map((m) => ({ id: m.id, motivo: 'Es lo que toca esta semana en el pueblo.' })),
        avisos: d.menu.filter((m) => m.malo && !m.avisado).slice(0, 2).map((m) => ({ id: m.id, motivo: 'Se nota en la calle.' })),
        foco: 'El pueblo empieza a moverse',
        cronica: 'Semana movida en el pueblo: los vecinos hablan del alcalde en el bar y en la plaza.',
        titulares: ['sucesos', 'cartas', 'anuncios'].map((sec) => {
          const n = (d.noticias ?? []).find((x) => x.seccion === sec);
          return { seccion: sec, sobre: n?.id ?? '', texto: n ? `Lo que se cuenta: ${n.texto.split(/[.:(]/)[0]}` : 'Semana tranquila en el pueblo' };
        }),
        pies: (d.fotos ?? []).map((f) => ({ id: f.id, texto: 'Un día que el pueblo no olvidará' })),
        gobierno_rival: d.gobierno_rival ? { picks: (d.gobierno_rival.opciones ?? []).slice(0, 1).map((o) => o.id), discurso: 'Gobernamos para todo el pueblo.' } : { picks: [], discurso: '' },
        encargo: d.encargos_posibles?.[0] ? { id: d.encargos_posibles[0].id, carta: 'Alcalde, se lo pido de corazón: nos haría mucha falta en el pueblo.' } : { id: '', carta: '' },
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }], usage: { prompt_tokens: 2500, completion_tokens: 200 } }));
      return;
    }
    const lote = whole.indexOf('Lote de vecinos');
    if (lote >= 0) {
      const list = JSON.parse(whole.slice(whole.indexOf('\n', lote) + 1));
      const decisiones = list.map((v, i) => {
        const acciones = v.acciones.map((a) => a.split(' ')[0]);
        // 2.3: si puede donar a una gran obra o abrir una casa rural, lo hace (para probar las metas grandes).
        const accion = acciones.find((a) => a.startsWith('donar_obra:') || a === 'abrir_casa_rural') ?? acciones.find((a) => a.startsWith('pedir:')) ?? acciones[0];
        return {
          vecino: v.vecino,
          accion,
          gesto: { con: v.con_quien[0]?.id ?? 0, tipo: v.con_quien.length ? 'acercarse' : 'ninguno' },
          actitud: 1,
          gasto: { donde: 'pueblo', tienda: 0, ocio: false },
          plan: i === 0 && v.necesidades.length ? { tipo: 'irse_si_no', necesidad: v.necesidades[0], meses: 3 } : { tipo: 'ninguno', necesidad: '', meses: 0 },
          pensamiento: `Soy ${v.nombre.split(' ')[0]} y esta semana me toca mover ficha en el pueblo.`,
          motivo: 'Con lo que está pasando en el pueblo, no puedo quedarme de brazos cruzados.',
          recuerdo: 'Esta semana he pedido cosas al alcalde.',
          biografia: whole.includes('"mensual":true') ? `${v.nombre.split(' ')[0]} vive en el pueblo y cada semana pide algo al alcalde.` : '',
        };
      });
      const delay = Number(process.env.FAKE_LLM_DELAY_MS ?? 0);
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ decisiones }) } }], usage: { prompt_tokens: 3000, completion_tokens: 80 * list.length } }));
      }, delay);
      return;
    }
    const isText = !Array.isArray(parsed.vecinos);
    if (isText) {
      const texto = 'Pues aquí andamos, alcalde, con ganas de que el pueblo siga creciendo.';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ texto }) } }], usage: { prompt_tokens: 500, completion_tokens: 30 } }));
      return;
    }
    const user = JSON.parse((data.messages?.[1]?.content ?? '{"vecinos":[]}').split('\n\n')[0]);
    const decisiones = user.vecinos.map((v) => ({
      vecino: v.vecino,
      accion: v.acciones[0].accion,
      motivo: `Soy ${v.nombre} y aquí me quedo, que este pueblo promete ${['mucho', 'bastante', 'de verdad', 'si nos dejan'][Math.floor(Math.random() * 4)]}.`,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ decisiones }) } }],
        usage: { prompt_tokens: 800, completion_tokens: 60 },
      }),
    );
  });
}).listen(port, () => console.log(`fake llm en ${port}`));
