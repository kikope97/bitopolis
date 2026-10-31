// Servidor LLM falso, compatible con OpenAI, para las pruebas de Playwright.
// Elige la primera acción de cada vecino y responde con un motivo fijo.
import { createServer } from 'node:http';

const port = Number(process.env.FAKE_LLM_PORT ?? 8099);
createServer((req, res) => {
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
