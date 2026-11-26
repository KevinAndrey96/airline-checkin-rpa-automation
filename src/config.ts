import { z } from "zod";

const flag = z
  .enum(["true", "false", "1", "0"])
  .default("true")
  .transform((value) => value === "true" || value === "1");
const milliseconds = (fallback: number) => z.coerce.number().int().min(0).default(fallback);

const environmentSchema = z.object({
  MANIFEST_PATH: z.string().min(1).default("data/passengers.csv"),
  OUTPUT_DIR: z.string().min(1).default("boarding_passes"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  BROWSER_HEADLESS: flag,
  BROWSER_SLOW_MO_MS: milliseconds(0),
  STEP_TIMEOUT_MS: milliseconds(30_000),
  NAVIGATION_TIMEOUT_MS: milliseconds(60_000),
  MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  RETRY_BASE_DELAY_MS: milliseconds(5_000),
  DELAY_BETWEEN_PASSENGERS_MS: milliseconds(5_000),
  AVIANCA_CHECKIN_URL: z.url().default("https://checkinnew.avianca.com/Check-In?lang=Es"),
  SKYVERN_API_URL: z.url().default("http://localhost:8000/v1"),
  SKYVERN_API_KEY: z.string().default(""),
  SKYVERN_ENGINE: z.string().default("skyvern-2.0"),
  SKYVERN_PROXY_LOCATION: z.string().default("NONE"),
  SKYVERN_MAX_STEPS: z.coerce.number().int().min(1).default(50),
  SKYVERN_POLL_INTERVAL_MS: milliseconds(5_000),
  SKYVERN_RUN_TIMEOUT_MS: milliseconds(30 * 60_000),
  COPA_CHECKIN_URL: z.url().default("https://checkin.copaair.com/"),
  COPA_MODE: z.enum(["task", "workflow"]).default("task"),
  COPA_WORKFLOW_ID: z.string().default(""),
});

export interface Config {
  manifestPath: string;
  outputDir: string;
  logLevel: z.output<typeof environmentSchema>["LOG_LEVEL"];
  browser: { headless: boolean; slowMoMs: number; stepTimeoutMs: number; navigationTimeoutMs: number };
  retry: { maxAttempts: number; baseDelayMs: number };
  delayBetweenPassengersMs: number;
  avianca: { checkInUrl: string };
  skyvern: {
    apiUrl: string;
    apiKey: string;
    engine: string;
    proxyLocation: string;
    maxSteps: number;
    pollIntervalMs: number;
    runTimeoutMs: number;
  };
  copa: { checkInUrl: string; mode: "task" | "workflow"; workflowId: string };
}

export function loadConfig(environment: NodeJS.ProcessEnv): Config {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`invalid configuration: ${details}`);
  }
  const env = result.data;
  if (env.COPA_MODE === "workflow" && env.COPA_WORKFLOW_ID === "") {
    throw new Error("invalid configuration: COPA_WORKFLOW_ID is required when COPA_MODE=workflow");
  }

  return {
    manifestPath: env.MANIFEST_PATH,
    outputDir: env.OUTPUT_DIR,
    logLevel: env.LOG_LEVEL,
    browser: {
      headless: env.BROWSER_HEADLESS,
      slowMoMs: env.BROWSER_SLOW_MO_MS,
      stepTimeoutMs: env.STEP_TIMEOUT_MS,
      navigationTimeoutMs: env.NAVIGATION_TIMEOUT_MS,
    },
    retry: { maxAttempts: env.MAX_ATTEMPTS, baseDelayMs: env.RETRY_BASE_DELAY_MS },
    delayBetweenPassengersMs: env.DELAY_BETWEEN_PASSENGERS_MS,
    avianca: { checkInUrl: env.AVIANCA_CHECKIN_URL },
    skyvern: {
      apiUrl: env.SKYVERN_API_URL.replace(/\/+$/, ""),
      apiKey: env.SKYVERN_API_KEY,
      engine: env.SKYVERN_ENGINE,
      proxyLocation: env.SKYVERN_PROXY_LOCATION,
      maxSteps: env.SKYVERN_MAX_STEPS,
      pollIntervalMs: env.SKYVERN_POLL_INTERVAL_MS,
      runTimeoutMs: env.SKYVERN_RUN_TIMEOUT_MS,
    },
    copa: { checkInUrl: env.COPA_CHECKIN_URL, mode: env.COPA_MODE, workflowId: env.COPA_WORKFLOW_ID },
  };
}
