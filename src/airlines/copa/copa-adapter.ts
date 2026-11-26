import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Logger } from "pino";
import { z } from "zod";
import { CheckInError, classifyAirlineMessage } from "../../domain/check-in-error.js";
import type { Passenger } from "../../domain/passenger.js";
import { SkyvernRunTimeoutError, type SkyvernClient, type SkyvernRun } from "../../skyvern/skyvern-client.js";
import type { AirlineAdapter, CheckInOutcome } from "../airline-adapter.js";
import { runDirectory } from "../output-paths.js";
import { taskRequest, workflowRequest, type TaskSettings } from "./skyvern-requests.js";

export type SkyvernApi = Pick<SkyvernClient, "runTask" | "runWorkflow" | "download">;

export interface CopaOptions extends TaskSettings {
  mode: "task" | "workflow";
  workflowId: string;
  outputDir: string;
}

const extractedSchema = z
  .object({
    check_in_completed: z.boolean().optional(),
    boarding_pass_available: z.boolean().optional(),
    error_message: z.string().nullish(),
  })
  .loose();

/** Copa check-in delegated to a Skyvern agent, as a single task or a published workflow. */
export class CopaAdapter implements AirlineAdapter {
  readonly airline = "copa";

  constructor(
    private readonly client: SkyvernApi,
    private readonly options: CopaOptions,
    private readonly logger: Logger,
  ) {}

  async checkIn(passenger: Passenger): Promise<CheckInOutcome> {
    const run = await this.launch(passenger);
    const directory = runDirectory(this.options.outputDir, passenger);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${run.run_id}.json`), JSON.stringify(run, null, 2), "utf8");

    if (run.status !== "completed") {
      const reason = run.failure_reason ?? `estado ${run.status}`;
      const code = classifyAirlineMessage(reason);
      throw new CheckInError(code === "ERR_UNKNOWN" ? "ERR_AUTOMATION_FAILED" : code, reason);
    }

    const extracted = extractedSchema.safeParse(run.output ?? {});
    const output = extracted.success ? extracted.data : {};
    if (output.error_message) {
      throw new CheckInError(classifyAirlineMessage(output.error_message), output.error_message);
    }

    const files = await this.saveDownloads(run, directory);
    const boardingPass = files[0] ?? "";
    if (boardingPass === "" && output.boarding_pass_available !== true) {
      throw new CheckInError("ERR_BOARDING_PASS_MISSING", `run ${run.run_id}`);
    }

    return { boardingPass, alreadyCheckedIn: false };
  }

  async close(): Promise<void> {
    // The Skyvern client keeps no open resources.
  }

  private async launch(passenger: Passenger): Promise<SkyvernRun> {
    try {
      if (this.options.mode === "workflow") {
        return await this.client.runWorkflow(
          workflowRequest(passenger, { workflowId: this.options.workflowId, proxyLocation: this.options.proxyLocation }),
        );
      }

      return await this.client.runTask(taskRequest(passenger, this.options));
    } catch (error) {
      if (error instanceof SkyvernRunTimeoutError) {
        throw new CheckInError("ERR_TIMEOUT", `run ${error.runId}`, { cause: error });
      }
      throw error;
    }
  }

  private async saveDownloads(run: SkyvernRun, directory: string): Promise<string[]> {
    const saved: string[] = [];
    for (const [index, file] of (run.downloaded_files ?? []).entries()) {
      try {
        const name = basename(file.filename ?? new URL(file.url).pathname) || `pasabordo-${index + 1}.pdf`;
        const path = join(directory, name);
        await writeFile(path, await this.client.download(file.url));
        saved.push(path);
      } catch (error) {
        this.logger.warn({ runId: run.run_id, err: error }, "skyvern artifact not downloaded");
      }
    }

    return saved;
  }
}
