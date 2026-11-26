import { describe, expect, it } from "vitest";
import type { AdapterProvider, AirlineAdapter, CheckInOutcome } from "../../src/airlines/airline-adapter.js";
import { CheckInError } from "../../src/domain/check-in-error.js";
import type { Airline, ManifestRow, Passenger } from "../../src/domain/passenger.js";
import type { Manifest } from "../../src/manifest/csv-manifest.js";
import { CheckInRunner, retryDelay, shouldProcess, type RunnerOptions } from "../../src/runner/check-in-runner.js";
import { row, silentLogger } from "../support/rows.js";

class MemoryManifest implements Manifest {
  saves = 0;

  constructor(readonly rows: ManifestRow[]) {}

  update(index: number, patch: Partial<ManifestRow>): void {
    const current = this.rows[index];
    if (current === undefined) {
      throw new RangeError(`no row ${index}`);
    }
    this.rows[index] = { ...current, ...patch };
  }

  save(): Promise<void> {
    this.saves++;

    return Promise.resolve();
  }
}

type Script = (passenger: Passenger, call: number) => CheckInOutcome | Error;

class ScriptedAdapters implements AdapterProvider {
  readonly calls: string[] = [];
  closed = false;

  constructor(private readonly script: Script) {}

  get(airline: Airline): Promise<AirlineAdapter> {
    const adapter: AirlineAdapter = {
      airline,
      checkIn: (passenger) => {
        this.calls.push(passenger.reservation_code);
        const result = this.script(passenger, this.calls.length);

        return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
      },
      close: () => Promise.resolve(),
    };

    return Promise.resolve(adapter);
  }

  closeAll(): Promise<void> {
    this.closed = true;

    return Promise.resolve();
  }
}

const options: RunnerOptions = { maxAttempts: 3, retryBaseDelayMs: 0, delayBetweenPassengersMs: 0 };
const boarded = (passenger: Passenger): CheckInOutcome => ({
  boardingPass: `boarding_passes/${passenger.airline}/${passenger.reservation_code}.png`,
  alreadyCheckedIn: false,
});

async function runWith(rows: ManifestRow[], script: Script, overrides: Partial<RunnerOptions> = {}) {
  const manifest = new MemoryManifest(rows);
  const adapters = new ScriptedAdapters(script);
  const summary = await new CheckInRunner(manifest, adapters, silentLogger, { ...options, ...overrides }).run();

  return { manifest, adapters, summary };
}

describe("CheckInRunner", () => {
  it("checks in pending passengers and records the boarding pass", async () => {
    const { manifest, summary, adapters } = await runWith([row(), row({ reservation_code: "AV456Y" })], boarded);

    expect(summary).toEqual({ total: 2, succeeded: 2, failed: 0, skipped: 0 });
    expect(manifest.rows[1]).toMatchObject({
      checkin_status: "SUCCESS",
      boarding_pass: "boarding_passes/avianca/AV456Y.png",
      attempt_count: "1",
    });
    expect(manifest.rows[1]?.checkin_date).not.toBe("");
    expect(adapters.closed).toBe(true);
  });

  it("marks invalid rows without calling the airline", async () => {
    const { manifest, adapters, summary } = await runWith([row({ email: "no-es-correo" })], boarded);

    expect(summary.failed).toBe(1);
    expect(adapters.calls).toEqual([]);
    expect(manifest.rows[0]).toMatchObject({ checkin_status: "ERROR", error_code: "ERR_INVALID_DATA", attempt_count: "0" });
    expect(manifest.rows[0]?.error_message).toContain("email: el correo no es válido");
  });

  it("retries retryable failures and succeeds", async () => {
    const { manifest, adapters } = await runWith([row()], (passenger, call) =>
      call === 1 ? new CheckInError("ERR_TIMEOUT") : boarded(passenger),
    );

    expect(adapters.calls).toHaveLength(2);
    expect(manifest.rows[0]).toMatchObject({ checkin_status: "SUCCESS", attempt_count: "2", error_code: "" });
  });

  it("stops at the first non retryable failure", async () => {
    const { manifest, adapters } = await runWith([row()], () => new CheckInError("ERR_RESERVATION_NOT_FOUND", "sin reserva"));

    expect(adapters.calls).toHaveLength(1);
    expect(manifest.rows[0]).toMatchObject({ checkin_status: "ERROR", error_code: "ERR_RESERVATION_NOT_FOUND" });
  });

  it("gives up after the maximum attempts", async () => {
    const { manifest, adapters } = await runWith([row()], () => new Error("boom"), { maxAttempts: 2 });

    expect(adapters.calls).toHaveLength(2);
    expect(manifest.rows[0]).toMatchObject({ checkin_status: "ERROR", error_code: "ERR_UNKNOWN", attempt_count: "2" });
  });

  it("only processes the requested airline", async () => {
    const { adapters, summary } = await runWith([row(), row({ airline: "copa", reservation_code: "CM777A" })], boarded, {
      airline: "copa",
    });

    expect(adapters.calls).toEqual(["CM777A"]);
    expect(summary.skipped).toBe(1);
  });

  it("closes the adapters even when saving fails", async () => {
    const manifest = new MemoryManifest([row()]);
    manifest.save = () => Promise.reject(new Error("disk full"));
    const adapters = new ScriptedAdapters(boarded);

    await expect(new CheckInRunner(manifest, adapters, silentLogger, options).run()).rejects.toThrow("disk full");
    expect(adapters.closed).toBe(true);
  });
});

describe("shouldProcess", () => {
  it.each<[string, Partial<ManifestRow>, boolean]>([
    ["new rows", { checkin_status: "" }, true],
    ["pending rows", { checkin_status: "PENDING", attempt_count: "5" }, true],
    ["interrupted rows", { checkin_status: "IN_PROGRESS", attempt_count: "1" }, true],
    ["finished rows", { checkin_status: "SUCCESS" }, false],
    ["retryable errors with attempts left", { checkin_status: "ERROR", error_code: "ERR_TIMEOUT", attempt_count: "1" }, true],
    ["retryable errors without attempts", { checkin_status: "ERROR", error_code: "ERR_TIMEOUT", attempt_count: "3" }, false],
    ["errors that need a person", { checkin_status: "ERROR", error_code: "ERR_CAPTCHA", attempt_count: "1" }, false],
    ["errors with an unknown code", { checkin_status: "ERROR", error_code: "", attempt_count: "0" }, false],
  ])("%s", (_case, overrides, expected) => {
    expect(shouldProcess(row(overrides), 3)).toBe(expected);
  });
});

describe("retryDelay", () => {
  it("doubles the delay and caps it at one minute", () => {
    expect([1, 2, 3, 10].map((attempt) => retryDelay(attempt, 5_000))).toEqual([5_000, 10_000, 20_000, 60_000]);
  });
});
