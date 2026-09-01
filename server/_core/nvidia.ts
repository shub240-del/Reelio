/** Server-only NVIDIA NIM provider with bounded retry and typed failures. */

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AICompletionOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  responseFormat?: "json" | "text";
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
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

export type AIProviderErrorCode =
  | "not_configured"
  | "cancelled"
  | "timeout"
  | "quota_exceeded"
  | "authentication_failed"
  | "upstream_unavailable"
  | "invalid_response";

export class AIProviderError extends Error {
  constructor(
    public readonly code: AIProviderErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly status?: number
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}

export interface AIProvider {
  complete(
    messages: AIMessage[],
    opts?: AICompletionOptions
  ): Promise<AICompletionResult>;
  isAvailable(): boolean;
  name(): string | null;
}

const NVIDIA_NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_NVIDIA_MODEL = "meta/llama-3.2-11b-vision-instruct";

const delay = (milliseconds: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new AIProviderError("cancelled", "AI request was cancelled."));
      },
      { once: true }
    );
  });

function classifyStatus(status: number): AIProviderError {
  if (status === 401 || status === 403) {
    return new AIProviderError(
      "authentication_failed",
      "The configured NVIDIA credentials were rejected.",
      false,
      status
    );
  }
  if (status === 429) {
    return new AIProviderError(
      "quota_exceeded",
      "The NVIDIA provider rate limit or quota was exceeded. Retry later.",
      true,
      status
    );
  }
  return new AIProviderError(
    "upstream_unavailable",
    `The NVIDIA provider returned HTTP ${status}.`,
    status >= 500 || status === 408,
    status
  );
}

class NvidiaNIMProvider implements AIProvider {
  constructor(private readonly apiKey: string) {}

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  name(): string {
    return "nvidia-nim";
  }

  async complete(
    messages: AIMessage[],
    opts: AICompletionOptions = {}
  ): Promise<AICompletionResult> {
    const model =
      opts.model ?? process.env.NVIDIA_MODEL ?? DEFAULT_NVIDIA_MODEL;
    const timeoutMs = Math.min(
      Math.max(opts.timeoutMs ?? 30_000, 1_000),
      60_000
    );
    const maxRetries = Math.min(Math.max(opts.maxRetries ?? 2, 0), 2);
    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: Math.min(Math.max(opts.maxTokens ?? 2048, 64), 4096),
      temperature: opts.temperature ?? 0.1,
      top_p: 1,
      stream: false,
    };
    if (opts.responseFormat === "json") {
      body.response_format = { type: "json_object" };
    }

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (opts.signal?.aborted) {
        throw new AIProviderError("cancelled", "AI request was cancelled.");
      }
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const signal = opts.signal
        ? AbortSignal.any([opts.signal, timeoutSignal])
        : timeoutSignal;
      try {
        const response = await fetch(
          `${NVIDIA_NIM_BASE_URL}/chat/completions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
            signal,
          }
        );

        if (!response.ok) {
          const error = classifyStatus(response.status);
          if (error.retryable && attempt < maxRetries) {
            await delay(200 * 2 ** attempt, opts.signal);
            continue;
          }
          throw error;
        }

        const json = (await response.json()) as {
          model?: string;
          choices?: Array<{ message?: { content?: string } }>;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
          };
        };
        const content = json.choices?.[0]?.message?.content;
        if (typeof content !== "string" || content.length === 0) {
          throw new AIProviderError(
            "invalid_response",
            "The NVIDIA provider returned no usable response."
          );
        }
        return {
          content,
          model: json.model ?? model,
          usage: {
            promptTokens: json.usage?.prompt_tokens ?? 0,
            completionTokens: json.usage?.completion_tokens ?? 0,
            totalTokens: json.usage?.total_tokens ?? 0,
          },
        };
      } catch (error) {
        if (error instanceof AIProviderError) throw error;
        if (opts.signal?.aborted) {
          throw new AIProviderError("cancelled", "AI request was cancelled.");
        }
        if (timeoutSignal.aborted) {
          if (attempt < maxRetries) continue;
          throw new AIProviderError(
            "timeout",
            "The NVIDIA provider timed out.",
            true
          );
        }
        if (attempt < maxRetries) {
          await delay(200 * 2 ** attempt, opts.signal);
          continue;
        }
        throw new AIProviderError(
          "upstream_unavailable",
          "The NVIDIA provider could not be reached.",
          true
        );
      }
    }
    throw new AIProviderError(
      "upstream_unavailable",
      "The NVIDIA provider could not be reached.",
      true
    );
  }
}

class UnavailableProvider implements AIProvider {
  isAvailable(): boolean {
    return false;
  }

  name(): null {
    return null;
  }

  async complete(): Promise<AICompletionResult> {
    throw new AIProviderError(
      "not_configured",
      "NVIDIA_API_KEY is not configured on this server."
    );
  }
}

let provider: AIProvider | null = null;

export function getAIProvider(): AIProvider {
  if (!provider) {
    const key = process.env.NVIDIA_API_KEY ?? "";
    provider = key ? new NvidiaNIMProvider(key) : new UnavailableProvider();
  }
  return provider;
}

export function resetAIProvider(): void {
  provider = null;
}
