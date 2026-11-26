import type { Logger } from "pino";
import { BrowserSession } from "../browser/browser-session.js";
import type { Config } from "../config.js";
import type { Airline } from "../domain/passenger.js";
import { SkyvernClient } from "../skyvern/skyvern-client.js";
import type { AdapterProvider, AirlineAdapter } from "./airline-adapter.js";
import { AviancaAdapter } from "./avianca/avianca-adapter.js";
import { CopaAdapter } from "./copa/copa-adapter.js";

/** Builds each adapter on first use, so a Copa-only manifest never launches Chromium. */
export class AdapterRegistry implements AdapterProvider {
  private readonly adapters = new Map<Airline, Promise<AirlineAdapter>>();

  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
  ) {}

  get(airline: Airline): Promise<AirlineAdapter> {
    let adapter = this.adapters.get(airline);
    if (adapter === undefined) {
      adapter = this.create(airline);
      this.adapters.set(airline, adapter);
      adapter.catch(() => this.adapters.delete(airline));
    }

    return adapter;
  }

  async closeAll(): Promise<void> {
    const adapters = await Promise.allSettled(this.adapters.values());
    this.adapters.clear();
    await Promise.allSettled(
      adapters.flatMap((result) => (result.status === "fulfilled" ? [result.value.close()] : [])),
    );
  }

  private async create(airline: Airline): Promise<AirlineAdapter> {
    const { config, logger } = this;
    switch (airline) {
      case "avianca": {
        const session = await BrowserSession.launch(config.browser);

        return new AviancaAdapter(session, { checkInUrl: config.avianca.checkInUrl, outputDir: config.outputDir }, logger);
      }
      case "copa": {
        if (config.skyvern.apiKey === "") {
          throw new Error("SKYVERN_API_KEY is required for copa check-ins");
        }
        const client = new SkyvernClient(config.skyvern, logger);

        return new CopaAdapter(
          client,
          {
            mode: config.copa.mode,
            workflowId: config.copa.workflowId,
            checkInUrl: config.copa.checkInUrl,
            engine: config.skyvern.engine,
            proxyLocation: config.skyvern.proxyLocation,
            maxSteps: config.skyvern.maxSteps,
            outputDir: config.outputDir,
          },
          logger,
        );
      }
    }
  }
}
