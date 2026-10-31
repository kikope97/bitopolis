/**
 * Proveedores, modelos por defecto y precios (€ por millón de tokens).
 *
 * Precios ORIENTATIVOS, consultados en octubre de 2026 en agregadores de
 * precios (las fuentes no coinciden entre sí). Revísalos en la página de cada
 * proveedor y sustitúyelos en /admin si cambian.
 */
export const PROVIDERS = ['anthropic', 'openai', 'gemini', 'deepseek', 'mistral', 'openrouter', 'openai-compatible'] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export interface ProviderInfo {
  label: string;
  /** Endpoint compatible con OpenAI (todos menos Anthropic). */
  baseUrl: string;
  cheap: string;
  premium: string;
  /** Admite response_format json_schema estricto. */
  jsonSchema: boolean;
  needsKey: boolean;
  /** Modelos sugeridos en Configurar (se puede escribir otro). */
  models?: string[];
}

export const PROVIDER_INFO: Record<ProviderId, ProviderInfo> = {
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    cheap: 'gpt-5.4-nano',
    premium: 'gpt-5.4-mini',
    jsonSchema: true,
    needsKey: true,
    models: ['gpt-5.4-nano', 'gpt-5.4-mini'],
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com',
    cheap: 'claude-haiku-5-5',
    premium: 'claude-sonnet-5-5',
    jsonSchema: true,
    needsKey: true,
    models: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
  },
  gemini: {
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    cheap: 'gemini-2.5-flash-lite',
    premium: 'gemini-2.5-flash',
    jsonSchema: true,
    needsKey: true,
  },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', cheap: 'deepseek-chat', premium: 'deepseek-chat', jsonSchema: false, needsKey: true },
  mistral: { label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', cheap: 'mistral-small-latest', premium: 'mistral-medium-latest', jsonSchema: true, needsKey: true },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', cheap: 'openai/gpt-5.4-nano', premium: 'openai/gpt-5.4-mini', jsonSchema: true, needsKey: true },
  'openai-compatible': { label: 'Compatible con OpenAI (Ollama, LM Studio…)', baseUrl: 'http://localhost:11434/v1', cheap: 'llama3.2', premium: 'llama3.2', jsonSchema: false, needsKey: false },
};

/**
 * El proveedor se deduce de la key (no se elige a mano): «sk-ant-…» es
 * Anthropic y cualquier otra, OpenAI. Con un endpoint propio, compatible con OpenAI.
 */
export function providerFromKey(key: string | undefined, baseUrl?: string | null): ProviderId {
  if (baseUrl) return 'openai-compatible';
  return key?.startsWith('sk-ant-') ? 'anthropic' : 'openai';
}

/** Un modelo sugerido para otro proveedor no vale: se usa el de serie del actual. */
export function modelFor(provider: ProviderId, model: string | undefined, kind: 'cheap' | 'premium'): string {
  const info = PROVIDER_INFO[provider];
  const foreign = (m: string) => PROVIDERS.some((p) => p !== provider && (PROVIDER_INFO[p].cheap === m || PROVIDER_INFO[p].premium === m || PROVIDER_INFO[p].models?.includes(m)));
  return model && !foreign(model) ? model : info[kind];
}

export interface Price {
  /** € por millón de tokens de entrada, de entrada en caché y de salida. */
  in: number;
  cachedIn?: number;
  out: number;
}

/** Tabla incluida (≈ USD × 0,92). Editable en /admin. */
export const DEFAULT_PRICES: Record<string, Price> = {
  'gpt-5.4-nano': { in: 0.19, cachedIn: 0.02, out: 1.15 },
  'gpt-5.4-mini': { in: 0.7, cachedIn: 0.07, out: 4.2 },
  // Anthropic: precios oficiales en USD (Haiku 5.5 $0,10/$0,50; Sonnet 5.5 $2/$10; Opus 5.5 $4/$20 por millón).
  'claude-haiku-5-5': { in: 0.092, cachedIn: 0.0092, out: 0.46 },
  'claude-sonnet-5-5': { in: 1.84, cachedIn: 0.18, out: 9.2 },
  'claude-opus-5-5': { in: 3.68, cachedIn: 0.18, out: 18.4 },
  'gemini-2.5-flash-lite': { in: 0.09, cachedIn: 0.02, out: 0.37 },
  'gemini-2.5-flash': { in: 0.28, cachedIn: 0.07, out: 2.3 },
  'deepseek-chat': { in: 0.26, cachedIn: 0.03, out: 0.39 },
  'mistral-small-latest': { in: 0.18, out: 0.55 },
  'mistral-medium-latest': { in: 1.38, out: 6.9 },
  'openai/gpt-5.4-nano': { in: 0.19, out: 1.15 },
  'openai/gpt-5.4-mini': { in: 0.7, out: 4.2 },
};

/** Precio de un modelo desconocido: se asume uno caro para no quedarse corto. */
export const UNKNOWN_PRICE: Price = { in: 3, out: 15 };

export function priceTable(custom: Record<string, Price> | undefined): Record<string, Price> {
  return custom ? { ...DEFAULT_PRICES, ...custom } : DEFAULT_PRICES;
}

export function costEur(prices: Record<string, Price>, model: string, provider: ProviderId, u: { in: number; cachedIn: number; out: number }): number {
  // Los modelos locales no cuestan dinero.
  const p = prices[model] ?? (provider === 'openai-compatible' ? { in: 0, out: 0 } : UNKNOWN_PRICE);
  return ((u.in - u.cachedIn) * p.in + u.cachedIn * (p.cachedIn ?? p.in) + u.out * p.out) / 1_000_000;
}
