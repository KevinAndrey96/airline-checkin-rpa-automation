import { setTimeout as sleep } from "node:timers/promises";
import type { Logger } from "pino";
import { z } from "zod";

export const TERMINAL_STATUSES = new Set(["completed", "failed", "terminated", "timed_out", "canceled"]);

const startedSchema = z.object({ run_id: z.string().min(1) }).loose();

const runSchema = z
  .object({
    run_id: z.string(),
    status: z.string(),
    output: z.unknown().nullish(),
    downloaded_files: z
      .array(z.object({ url: z.string(), checksum: z.string().nullish(), filename: z.string().nullish() }).loose())
      .nullish(),
    failure_reason: z.string().nullish(),
    recording_url: z.string().nullish(),
  })
  .loose();

const workflowListSchema = z.array(
  z
    .object({
      workflow_permanent_id: z.string(),
      title: z.string().nullish(),
      version: z.number().nullish(),
    })
    .loose(),
);

export type SkyvernRun = z.output<typeof runSchema>;
export type SkyvernWorkflow = z.output<typeof workflowListSchema>[number];

export interface SkyvernOptions {
  apiUrl: string;
  apiKey: string;
  pollIntervalMs: number;
  runTimeoutMs: number;
  requestTimeoutMs?: number;
  maxRequestAttempts?: number;
  retryBaseDelayMs?: number;
}

export class SkyvernRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SkyvernRequestError";
  }
}

export class SkyvernRunTimeoutError extends Error {
  constructor(readonly runId: string) {
    super(`skyvern run ${runId} did not finish in time`);
    this.name = "SkyvernRunTimeoutError";
  }
}

const RETRY_ANY_METHOD = new Set([429, 502, 503]);

function isTransient(method: string, status: number): boolean {
  return RETRY_ANY_METHOD.has(status) || (method === "GET" && status >= 500);
}

/**
 * Minimal client for the Skyvern v1 API with request timeouts, retries with
 * exponential backoff for transient failures and polling until a run ends.
 * POST requests are retried only when the server clearly did not accept them,
 * so a flaky connection never launches the same check-in twice.
 */
export class SkyvernClient {
  private readonly origin: string;

  constructor(
    private readonly options: SkyvernOptions,
    private readonly logger: Logger,
  ) {
    this.origin = new URL(options.apiUrl).origin;
  }

  async runTask(body: Record<string, unknown>): Promise<SkyvernRun> {
    const started = await this.request("POST", "/run/tasks", startedSchema, body);

    return this.waitForRun(started.run_id);
  }

  async runWorkflow(body: Record<string, unknown>): Promise<SkyvernRun> {
    const started = await this.request("POST", "/run/workflows", startedSchema, body);

    return this.waitForRun(started.run_id);
  }

  async getRun(runId: string): Promise<SkyvernRun> {
    return this.request("GET", `/runs/${encodeURIComponent(runId)}`, runSchema);
  }

  async listWorkflows(): Promise<SkyvernWorkflow[]> {
    return this.request("GET", "/workflows?page=1&page_size=50", workflowListSchema);
  }

  async waitForRun(runId: string): Promise<SkyvernRun> {
    const deadline = Date.now() + this.options.runTimeoutMs;
    this.logger.info({ runId }, "skyvern run started");
    for (;;) {
      const run = await this.getRun(runId);
      if (TERMINAL_STATUSES.has(run.status)) {
        this.logger.info({ runId, status: run.status }, "skyvern run finished");

        return run;
      }
      if (Date.now() + this.options.pollIntervalMs > deadline) {
        throw new SkyvernRunTimeoutError(runId);
      }
      await sleep(this.options.pollIntervalMs);
    }
  }

  /** Downloads an artifact; the API key is only sent to the Skyvern server itself. */
  async download(url: string): Promise<Buffer> {
    const target = new URL(url, this.options.apiUrl);
    const headers: Record<string, string> = target.origin === this.origin ? { "x-api-key": this.options.apiKey } : {};
    const response = await fetch(target, { headers, signal: AbortSignal.timeout(this.requestTimeout()) });
    if (!response.ok) {
      throw new SkyvernRequestError(`skyvern artifact ${target.pathname}: ${response.status}`, response.status);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  private async request<T>(method: "GET" | "POST", path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    const maxAttempts = this.options.maxRequestAttempts ?? 3;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.send(method, path, schema, body);
      } catch (error) {
        const transient =
          error instanceof SkyvernRequestError
            ? isTransient(method, error.status)
            : method === "GET" && error instanceof Error && error.name !== "ZodError";
        if (!transient || attempt >= maxAttempts) {
          throw error;
        }
        const delay = (this.options.retryBaseDelayMs ?? 1_000) * 2 ** (attempt - 1);
        this.logger.warn({ method, path, attempt, delay }, "skyvern request retried");
        await sleep(delay);
      }
    }
  }

  private async send<T>(method: string, path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    const response = await fetch(`${this.options.apiUrl}${path}`, {
      method,
      headers: { "content-type": "application/json", "x-api-key": this.options.apiKey },
      signal: AbortSignal.timeout(this.requestTimeout()),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new SkyvernRequestError(`skyvern ${method} ${path}: ${response.status} ${text.slice(0, 200)}`, response.status);
    }

    return schema.parse(text === "" ? null : JSON.parse(text));
  }

  private requestTimeout(): number {
    return this.options.requestTimeoutMs ?? 30_000;
  }
}
