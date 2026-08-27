/**
 * NVIDIA NIM AI Provider — server-side only.
 *
 * SECURITY: NVIDIA_API_KEY is read exclusively from process.env on the server.
 * It is never sent to the browser, never logged, never included in API
 * responses, and never stored in VITE_* variables.
 *
 * Architecture:
 *   AIProvider (abstract interface)
 *       └── NvidiaNIMProvider (implements AIProvider via NIM API)
 *
 * The rest of the codebase calls `getAIProvider()` to obtain a provider
 * instance; it never imports NIM-specific code directly.
 */

// ─── Provider interface ────────────────────────────────────────────────────

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AICompletionOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  responseFormat?: "json" | "text";
}

export interface AICompletionResult {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface AIProvider {
  complete(messages: AIMessage[], opts?: AICompletionOptions): Promise<AICompletionResult>;
  isAvailable(): boolean;
}

// ─── NVIDIA NIM implementation ─────────────────────────────────────────────

const NVIDIA_NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";

/**
 * Default model: meta/llama-3.2-11b-vision-instruct (active, fast NVIDIA NIM model).
 * JSON-structured output is critical for the edit-plan workflow.
 */
const DEFAULT_NVIDIA_MODEL = "meta/llama-3.2-11b-vision-instruct";

class NvidiaNIMProvider implements AIProvider {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  async complete(
    messages: AIMessage[],
    opts: AICompletionOptions = {},
  ): Promise<AICompletionResult> {
    const model = opts.model ?? DEFAULT_NVIDIA_MODEL;
    const maxTokens = opts.maxTokens ?? 2048;
    const temperature = opts.temperature ?? 0.1;

    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
      top_p: 1,
      stream: false,
    };

    if (opts.responseFormat === "json") {
      body.response_format = { type: "json_object" };
    }

    let response: Response;
    try {
      response = await fetch(`${NVIDIA_NIM_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Key is sent only in the server-to-NIM request, never to the browser
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      throw new Error(
        `NVIDIA NIM network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      let detail = "";
      try {
        detail = await response.text();
      } catch {
        // ignore
      }
      throw new Error(
        `NVIDIA NIM API error ${response.status}: ${response.statusText}${detail ? ` — ${detail.slice(0, 300)}` : ""}`,
      );
    }

    const json = (await response.json()) as {
      id: string;
      model: string;
      choices: Array<{
        message: { role: string; content: string };
        finish_reason: string;
      }>;
      usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    };

    const choice = json.choices?.[0];
    if (!choice) {
      throw new Error("NVIDIA NIM returned no choices");
    }

    return {
      content: choice.message.content ?? "",
      model: json.model ?? model,
      usage: {
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0,
        totalTokens: json.usage?.total_tokens ?? 0,
      },
    };
  }
}

// ─── Fallback (no key configured) ─────────────────────────────────────────

class UnavailableProvider implements AIProvider {
  isAvailable(): boolean {
    return false;
  }

  async complete(): Promise<AICompletionResult> {
    throw new Error(
      "NVIDIA_API_KEY is not configured. Set it in your .env file to enable AI features.",
    );
  }
}

// ─── Singleton accessor ────────────────────────────────────────────────────

let _provider: AIProvider | null = null;

/**
 * Returns the active AI provider.
 * Call once per request — the singleton is cheap to access.
 * NVIDIA_API_KEY is read from process.env (server-side only).
 */
export function getAIProvider(): AIProvider {
  if (!_provider) {
    const key = process.env.NVIDIA_API_KEY ?? "";
    _provider = key.length > 0 ? new NvidiaNIMProvider(key) : new UnavailableProvider();
  }
  return _provider;
}

/** Exposed for testing; resets the singleton so a new key can be picked up. */
export function resetAIProvider(): void {
  _provider = null;
}
