import { setTimeout as sleep } from "node:timers/promises";
import type { Logger } from "pino";
import type { AdapterProvider } from "../airlines/airline-adapter.js";
import { CheckInError, ERROR_CATALOG, toCheckInError, type ErrorCode } from "../domain/check-in-error.js";
import { parsePassenger, type Airline, type ManifestRow, type Passenger } from "../domain/passenger.js";
import type { Manifest } from "../manifest/csv-manifest.js";

export interface RunnerOptions {
  maxAttempts: number;
  retryBaseDelayMs: number;
  delayBetweenPassengersMs: number;
  airline?: Airline;
}

export interface RunSummary {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

const MAX_RETRY_DELAY_MS = 60_000;

function isRetryableCode(code: string): boolean {
  return code in ERROR_CATALOG && ERROR_CATALOG[code as ErrorCode].retryable;
}

/**
 * Decides whether a manifest row should be attempted in this run. Finished rows
 * are skipped, interrupted rows are resumed and failed rows are retried only
 * while the error is retryable and attempts remain.
 */
export function shouldProcess(row: ManifestRow, maxAttempts: number): boolean {
  switch (row.checkin_status) {
    case "":
    case "PENDING":
    case "IN_PROGRESS":
      return true;
    case "ERROR":
      return isRetryableCode(row.error_code) && (Number(row.attempt_count) || 0) < maxAttempts;
    default:
      return false;
  }
}

export function retryDelay(attempt: number, baseDelayMs: number): number {
  return Math.min(baseDelayMs * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
}

export class CheckInRunner {
  constructor(
    private readonly manifest: Manifest,
    private readonly adapters: AdapterProvider,
    private readonly logger: Logger,
    private readonly options: RunnerOptions,
  ) {}

  async run(): Promise<RunSummary> {
    const summary: RunSummary = { total: this.manifest.rows.length, succeeded: 0, failed: 0, skipped: 0 };
    const queue = this.manifest.rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => this.options.airline === undefined || row.airline.trim().toLowerCase() === this.options.airline);
    summary.skipped = summary.total - queue.length;

    try {
      let first = true;
      for (const { row, index } of queue) {
        if (!shouldProcess(row, this.options.maxAttempts)) {
          summary.skipped++;
          continue;
        }
        if (!first && this.options.delayBetweenPassengersMs > 0) {
          await sleep(this.options.delayBetweenPassengersMs);
        }
        first = false;

        const succeeded = await this.process(index, row);
        if (succeeded) {
          summary.succeeded++;
        } else {
          summary.failed++;
        }
      }
    } finally {
      await this.adapters.closeAll();
    }

    return summary;
  }

  private async process(index: number, row: ManifestRow): Promise<boolean> {
    const parsed = parsePassenger(row);
    if (!parsed.ok) {
      await this.fail(index, new CheckInError("ERR_INVALID_DATA", parsed.errors.join("; ")));

      return false;
    }

    const passenger = parsed.passenger;
    const log = this.logger.child({ airline: passenger.airline, reservation: passenger.reservation_code, row: index + 2 });
    let attempts = Number(row.attempt_count) || 0;

    for (;;) {
      attempts++;
      this.manifest.update(index, {
        checkin_status: "IN_PROGRESS",
        attempt_count: String(attempts),
        last_attempt_date: new Date().toISOString(),
      });
      await this.manifest.save();
      log.info({ attempt: attempts }, "check-in started");

      try {
        const outcome = await this.attempt(passenger);
        this.manifest.update(index, {
          checkin_status: "SUCCESS",
          checkin_date: new Date().toISOString(),
          boarding_pass: outcome.boardingPass,
          error_code: "",
          error_message: "",
        });
        await this.manifest.save();
        log.info({ boardingPass: outcome.boardingPass, alreadyCheckedIn: outcome.alreadyCheckedIn }, "check-in completed");

        return true;
      } catch (error) {
        const failure = toCheckInError(error);
        log.warn({ code: failure.code, attempt: attempts, err: failure }, "check-in attempt failed");
        if (!failure.retryable || attempts >= this.options.maxAttempts) {
          await this.fail(index, failure);

          return false;
        }
        await sleep(retryDelay(attempts, this.options.retryBaseDelayMs));
      }
    }
  }

  private async attempt(passenger: Passenger) {
    const adapter = await this.adapters.get(passenger.airline);

    return adapter.checkIn(passenger);
  }

  private async fail(index: number, failure: CheckInError): Promise<void> {
    this.manifest.update(index, {
      checkin_status: "ERROR",
      error_code: failure.code,
      error_message: failure.message,
    });
    await this.manifest.save();
  }
}
