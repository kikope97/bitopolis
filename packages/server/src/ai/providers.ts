import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { PROVIDER_INFO, type ProviderId } from './catalog.ts';

export interface LLMRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  model: string;
  maxTokens: number;
}

export interface LLMResult {
  text: string;
  usage: { in: number; cachedIn: number; out: number };
}

export interface LLMProvider {
  complete(req: LLMRequest, signal?: AbortSignal): Promise<LLMResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

/** Nunca se incluye la key en los mensajes de error. */
async function post(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  const text = await r.text();
  if (!r.ok) throw new ProviderError(`el proveedor respondió ${r.status}`, r.status);
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError('respuesta del proveedor no es JSON');
  }
}

/** OpenAI, Gemini, DeepSeek, Mistral, OpenRouter, Ollama, LM Studio… */
export class OpenAICompatProvider implements LLMProvider {
  constructor(
    private provider: ProviderId,
    private baseUrl: string,
    private key: string | undefined,
  ) {}

  async complete(req: LLMRequest, signal?: AbortSignal): Promise<LLMResult> {
    const info = PROVIDER_INFO[this.provider];
    const isOpenAI = this.provider === 'openai';
    const body: Record<string, unknown> = {
      model: req.model,
      messages: [
        { role: 'system', content: info.jsonSchema ? req.system : `${req.system}\n\nEsquema JSON de la respuesta:\n${JSON.stringify(req.schema)}` },
        { role: 'user', content: req.user },
      ],
      response_format: info.jsonSchema
        ? { type: 'json_schema', json_schema: { name: 'decisiones', strict: true, schema: req.schema } }
        : { type: 'json_object' },
    };
    // Los modelos de razonamiento de OpenAI no admiten temperatura distinta de la de serie.
    if (isOpenAI) body.max_completion_tokens = req.maxTokens;
    else {
      body.max_tokens = req.maxTokens;
      body.temperature = 0.3;
    }
    const headers: Record<string, string> = {};
    if (this.key) headers.Authorization = `Bearer ${this.key}`;
    if (this.provider === 'openrouter') headers['X-Title'] = 'Bitopolis';
    const data = await post(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, headers, body, signal);
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new ProviderError('respuesta sin contenido');
    const u = data.usage ?? {};
    return {
      text,
      usage: { in: u.prompt_tokens ?? 0, cachedIn: u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0, out: u.completion_tokens ?? 0 },
    };
  }
}

/**
 * Anthropic Messages API con el SDK oficial. La salida estructurada va por
 * `output_config.format` (los modelos 5.5 no admiten forzar una herramienta ni
 * cambiar la temperatura) y el esfuerzo de razonamiento al mínimo: decidir
 * entre unas pocas acciones no necesita pensar mucho y así se gasta menos.
 */
export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;

  constructor(key: string, baseUrl?: string) {
    // Los reintentos los decide el servicio (con su presupuesto), no el SDK.
    this.client = new Anthropic({ apiKey: key, baseURL: baseUrl || undefined, maxRetries: 0 });
  }

  async complete(req: LLMRequest, signal?: AbortSignal): Promise<LLMResult> {
    let msg: Anthropic.Message;
    try {
      msg = await this.client.messages.create(
        {
          model: req.model,
          // Margen para el razonamiento (cuenta como salida).
          max_tokens: req.maxTokens + 1024,
          system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: req.user }],
          output_config: { effort: 'low', format: { type: 'json_schema', schema: req.schema } },
        },
        { signal },
      );
    } catch (e) {
      // Solo el código de estado: nunca el mensaje completo (no debe acabar la key en un log).
      if (e instanceof Anthropic.APIError) throw new ProviderError(`el proveedor respondió ${e.status ?? 'sin estado'}`, e.status);
      throw e;
    }
    if (msg.stop_reason === 'refusal') throw new ProviderError('el modelo rechazó la petición');
    const text = msg.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
    if (!text) throw new ProviderError('respuesta sin contenido');
    const u = msg.usage;
    const cached = u.cache_read_input_tokens ?? 0;
    return {
      text,
      usage: { in: u.input_tokens + cached + (u.cache_creation_input_tokens ?? 0), cachedIn: cached, out: u.output_tokens },
    };
  }
}

/**
 * Respuestas grabadas: cero llamadas de red y siempre el mismo resultado.
 * La clave es el hash del prompt (sistema + usuario).
 */
export class ReplayProvider implements LLMProvider {
  constructor(
    private recordings: Map<string, LLMResult>,
    private fallback?: (req: LLMRequest) => LLMResult,
  ) {}

  static key(req: Pick<LLMRequest, 'system' | 'user'>): string {
    return createHash('sha256').update(req.system).update('\u0000').update(req.user).digest('hex').slice(0, 32);
  }

  async complete(req: LLMRequest): Promise<LLMResult> {
    const hit = this.recordings.get(ReplayProvider.key(req));
    if (hit) return hit;
    if (this.fallback) return this.fallback(req);
    throw new ProviderError('sin grabación para este prompt');
  }
}

export function makeProvider(provider: ProviderId, key: string | undefined, baseUrl: string | undefined): LLMProvider {
  if (provider === 'anthropic') {
    if (!key) throw new ProviderError('falta la API key');
    return new AnthropicProvider(key, baseUrl || undefined);
  }
  if (PROVIDER_INFO[provider].needsKey && !key) throw new ProviderError('falta la API key');
  return new OpenAICompatProvider(provider, baseUrl || PROVIDER_INFO[provider].baseUrl, key);
}
