import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { CopaAdapter, type CopaOptions, type SkyvernApi } from "../../src/airlines/copa/copa-adapter.js";
import { checkInPrompt, copaLastName, taskRequest, workflowRequest } from "../../src/airlines/copa/skyvern-requests.js";
import { SkyvernRunTimeoutError, type SkyvernRun } from "../../src/skyvern/skyvern-client.js";
import { passenger, silentLogger } from "../support/rows.js";

const copaPassenger = passenger({ airline: "copa", reservation_code: "CM777A", last_name: "de la Torre" });

describe("Copa requests", () => {
  it("writes the surname the way Copa expects it", () => {
    expect(copaLastName("  de la Torre ")).toBe("DELATORRE");
  });

  it("includes every field the agent needs and the payment guard", () => {
    const prompt = checkInPrompt(copaPassenger, "https://checkin.copaair.com/");

    expect(prompt).toContain("Código de reserva: CM777A");
    expect(prompt).toContain("Apellido como aparece en la reserva: DELATORRE");
    expect(prompt).toContain("Contacto de emergencia: Mariana Gomez, +573109876543, Colombia");
    expect(prompt).toContain("Silla preferida: ventana");
    expect(prompt).toContain("No pagues ningún servicio adicional");
    expect(prompt).not.toContain("Vencimiento del documento");
    expect(prompt).not.toMatch(/\n\n\n/);
  });

  it("builds task and workflow requests", () => {
    expect(
      taskRequest(copaPassenger, { checkInUrl: "https://checkin.copaair.com/", engine: "skyvern-2.0", proxyLocation: "NONE", maxSteps: 40 }),
    ).toMatchObject({ url: "https://checkin.copaair.com/", engine: "skyvern-2.0", max_steps: 40, title: "Copa check-in CM777A" });
    expect(workflowRequest(copaPassenger, { workflowId: "wpid_1", proxyLocation: "NONE" })).toMatchObject({
      workflow_id: "wpid_1",
      parameters: { reservation_code: "CM777A", last_name: "DELATORRE" },
    });
  });
});

class FakeSkyvern implements SkyvernApi {
  tasks = 0;
  workflows = 0;

  constructor(private readonly result: SkyvernRun | Error) {}

  runTask(): Promise<SkyvernRun> {
    this.tasks++;

    return this.result instanceof Error ? Promise.reject(this.result) : Promise.resolve(this.result);
  }

  runWorkflow(): Promise<SkyvernRun> {
    this.workflows++;

    return this.result instanceof Error ? Promise.reject(this.result) : Promise.resolve(this.result);
  }

  download(url: string): Promise<Buffer> {
    return url.includes("roto") ? Promise.reject(new Error("404")) : Promise.resolve(Buffer.from("%PDF-1.7"));
  }
}

describe("CopaAdapter", () => {
  let options: CopaOptions;

  beforeEach(async () => {
    options = {
      mode: "task",
      workflowId: "",
      checkInUrl: "https://checkin.copaair.com/",
      engine: "skyvern-2.0",
      proxyLocation: "NONE",
      maxSteps: 50,
      outputDir: await mkdtemp(join(tmpdir(), "copa-")),
    };
  });

  const adapter = (skyvern: SkyvernApi, overrides: Partial<CopaOptions> = {}) =>
    new CopaAdapter(skyvern, { ...options, ...overrides }, silentLogger);

  it("saves the downloaded boarding pass and the run record", async () => {
    const run: SkyvernRun = {
      run_id: "tsk_9",
      status: "completed",
      output: { check_in_completed: true, boarding_pass_available: true },
      downloaded_files: [{ url: "https://skyvern.local/files/pasabordo.pdf" }],
    };

    const outcome = await adapter(new FakeSkyvern(run)).checkIn(copaPassenger);

    expect(outcome.boardingPass).toBe(join(options.outputDir, "copa", "CM777A", "pasabordo.pdf"));
    await expect(readFile(outcome.boardingPass, "utf8")).resolves.toBe("%PDF-1.7");
    await expect(readFile(join(options.outputDir, "copa", "CM777A", "tsk_9.json"), "utf8")).resolves.toContain("tsk_9");
  });

  it("uses the published workflow when configured", async () => {
    const skyvern = new FakeSkyvern({ run_id: "wr_1", status: "completed", output: { boarding_pass_available: true } });

    await adapter(skyvern, { mode: "workflow", workflowId: "wpid_1" }).checkIn(copaPassenger);

    expect([skyvern.tasks, skyvern.workflows]).toEqual([0, 1]);
  });

  it.each<[string, SkyvernRun | Error, string]>([
    ["failed runs", { run_id: "r", status: "failed", failure_reason: "agent got lost" }, "ERR_AUTOMATION_FAILED"],
    ["runs that report a missing reservation", { run_id: "r", status: "failed", failure_reason: "Reservation not found" }, "ERR_RESERVATION_NOT_FOUND"],
    ["extracted airline errors", { run_id: "r", status: "completed", output: { error_message: "Debe realizar un pago" } }, "ERR_PAYMENT_REQUIRED"],
    ["runs without boarding pass", { run_id: "r", status: "completed", output: { check_in_completed: true }, downloaded_files: [{ url: "https://x/roto.pdf" }] }, "ERR_BOARDING_PASS_MISSING"],
    ["runs that time out", new SkyvernRunTimeoutError("r"), "ERR_TIMEOUT"],
  ])("reports %s", async (_case, result, code) => {
    await expect(adapter(new FakeSkyvern(result)).checkIn(copaPassenger)).rejects.toMatchObject({ code });
  });
});
