import { mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AviancaAdapter } from "../../src/airlines/avianca/avianca-adapter.js";
import { runCli } from "../../src/app.js";
import { BrowserSession } from "../../src/browser/browser-session.js";
import { parseManifest, serializeManifest } from "../../src/manifest/csv-manifest.js";
import { json, startServer, type TestServer } from "../support/http-server.js";
import { passenger, row, silentLogger } from "../support/rows.js";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "avianca");

let site: TestServer;
let submissions: Record<string, string>[];
let session: BrowserSession;
let outputDir: string;

beforeAll(async () => {
  site = await startServer((request, response) => {
    if (request.method === "POST") {
      submissions.push(JSON.parse(request.body) as Record<string, string>);
      json(response, 204, {});

      return;
    }
    const file = request.url.startsWith("/app.js") ? "app.js" : "index.html";
    void readFile(join(FIXTURE, file)).then((content) => {
      response.writeHead(200, { "content-type": file.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8" });
      response.end(content);
    });
  });
  session = await BrowserSession.launch({ headless: true, slowMoMs: 0, stepTimeoutMs: 5_000, navigationTimeoutMs: 10_000 });
});

afterAll(async () => {
  await session.close();
  await site.close();
});

beforeEach(async () => {
  submissions = [];
  outputDir = await mkdtemp(join(tmpdir(), "avianca-"));
});

const adapter = () =>
  new AviancaAdapter(session, { checkInUrl: `${site.url}/Check-In?lang=Es`, outputDir }, silentLogger);

describe("AviancaAdapter against the fixture site", () => {
  it("completes the whole check-in with the manifest data", async () => {
    const outcome = await adapter().checkIn(
      passenger({ document_type: "PA", document_number: "PA123456", document_expiry_date: "2031-10-15", gender: "F" }),
    );

    expect(outcome).toEqual({
      alreadyCheckedIn: false,
      boardingPass: join(outputDir, "avianca", "AV123X_GOMEZ-HERRERA_ALEJANDRO.png"),
    });
    expect((await stat(outcome.boardingPass)).size).toBeGreaterThan(1_000);
    expect(submissions).toEqual([
      {
        reservation: "AV123X",
        lastNames: "GOMEZ HERRERA",
        email: "alejandro.gomez@example.com",
        phone: "+573001234567",
        gender: "Femenino",
        countryResidence: "Colombia",
        purposeOfVisit: "Turismo, vacaciones, placer",
        birthDate: "14/05/1992",
        documentType: "Pasaporte",
        documentNumber: "PA123456",
        documentName: "ALEJANDRO",
        documentSurname: "GOMEZ HERRERA",
        nationality: "Colombia",
        issuingCountry: "Colombia",
        expiryDate: "15/10/2031",
        name: "Mariana Gomez",
        phoneCountryCode: "+57",
        number: "3109876543",
        countryCode: "Colombia",
      },
    ]);
  });

  it("downloads the boarding pass when the passenger already checked in", async () => {
    const outcome = await adapter().checkIn(passenger({ reservation_code: "DONE01" }));

    expect(outcome.alreadyCheckedIn).toBe(true);
    expect(submissions).toHaveLength(1);
  });

  it.each([
    ["NOEXIST", "ERR_RESERVATION_NOT_FOUND", /No encontramos una reserva/],
    ["BADDOC", "ERR_INVALID_DATA", /El número de documento no es válido/],
    ["SLOW01", "ERR_TIMEOUT", /paso pasabordo/],
  ])("reports %s as %s with an error screenshot", async (code, errorCode, message) => {
    await expect(adapter().checkIn(passenger({ reservation_code: code }))).rejects.toMatchObject({
      code: errorCode,
      message: expect.stringMatching(message) as unknown,
    });
    const screenshots = await readdir(join(outputDir, "errores", "avianca"));
    expect(screenshots).toEqual([expect.stringMatching(new RegExp(`^${code}_.+\\.png$`)) as unknown]);
  });
});

describe("checkin run", () => {
  it("updates the manifest for every passenger", async () => {
    const manifestPath = join(outputDir, "passengers.csv");
    await writeFile(
      manifestPath,
      serializeManifest([row(), row({ reservation_code: "NOEXIST" }), row({ reservation_code: "DONE01", checkin_status: "SUCCESS" })]),
    );
    let printed = "";

    const exitCode = await runCli(
      ["run", "--manifest", manifestPath],
      {
        AVIANCA_CHECKIN_URL: `${site.url}/Check-In?lang=Es`,
        OUTPUT_DIR: outputDir,
        LOG_LEVEL: "silent",
        STEP_TIMEOUT_MS: "5000",
        DELAY_BETWEEN_PASSENGERS_MS: "0",
        RETRY_BASE_DELAY_MS: "0",
      },
      { write: (text) => (printed += text) },
    );

    const rows = parseManifest(await readFile(manifestPath, "utf8"));
    expect(exitCode).toBe(1);
    expect(rows.map((entry) => [entry.reservation_code, entry.checkin_status, entry.error_code])).toEqual([
      ["AV123X", "SUCCESS", ""],
      ["NOEXIST", "ERROR", "ERR_RESERVATION_NOT_FOUND"],
      ["DONE01", "SUCCESS", ""],
    ]);
    expect(rows[0]?.boarding_pass).toMatch(/AV123X_GOMEZ-HERRERA_ALEJANDRO\.png$/);
    expect(printed).toContain("Exitosos:                   1");
    expect(printed).toContain("Omitidos:                   1");
  });
});
