import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boardingPassFile, errorScreenshotFile } from "../../src/airlines/output-paths.js";
import { loadConfig } from "../../src/config.js";

describe("loadConfig", () => {
  it("uses safe defaults", () => {
    const config = loadConfig({});

    expect(config).toMatchObject({
      manifestPath: "data/passengers.csv",
      outputDir: "boarding_passes",
      browser: { headless: true, slowMoMs: 0, stepTimeoutMs: 30_000 },
      retry: { maxAttempts: 3, baseDelayMs: 5_000 },
      avianca: { checkInUrl: "https://checkinnew.avianca.com/Check-In?lang=Es" },
      copa: { mode: "task" },
    });
  });

  it("reads overrides and trims the api url", () => {
    const config = loadConfig({ BROWSER_HEADLESS: "false", MAX_ATTEMPTS: "5", SKYVERN_API_URL: "http://skyvern:8000/v1/" });

    expect(config.browser.headless).toBe(false);
    expect(config.retry.maxAttempts).toBe(5);
    expect(config.skyvern.apiUrl).toBe("http://skyvern:8000/v1");
  });

  it.each([
    [{ MAX_ATTEMPTS: "0" }, /MAX_ATTEMPTS/],
    [{ BROWSER_HEADLESS: "quizas" }, /BROWSER_HEADLESS/],
    [{ AVIANCA_CHECKIN_URL: "no-es-url" }, /AVIANCA_CHECKIN_URL/],
    [{ COPA_MODE: "workflow" }, /COPA_WORKFLOW_ID is required/],
  ])("rejects %j", (environment, message) => {
    expect(() => loadConfig(environment)).toThrow(message);
  });
});

describe("output paths", () => {
  const passenger = { airline: "avianca" as const, reservation_code: "AV123X", last_name: "Peña Núñez", first_name: "José María" };

  it("names boarding passes after the reservation and the passenger", () => {
    expect(boardingPassFile("salida", passenger, "png")).toBe(join("salida", "avianca", "AV123X_PENA-NUNEZ_JOSE-MARIA.png"));
  });

  it("keeps error screenshots apart and timestamped", () => {
    expect(errorScreenshotFile("salida", passenger)).toMatch(/^salida\/errores\/avianca\/AV123X_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.png$/);
  });
});
