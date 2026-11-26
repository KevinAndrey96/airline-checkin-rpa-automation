import { parseArgs } from "node:util";
import type { Logger } from "pino";
import { AdapterRegistry } from "./airlines/registry.js";
import { loadConfig, type Config } from "./config.js";
import { AIRLINES, parsePassenger, type Airline } from "./domain/passenger.js";
import { createLogger } from "./logger.js";
import { CsvManifest } from "./manifest/csv-manifest.js";
import { CheckInRunner } from "./runner/check-in-runner.js";
import { SkyvernClient } from "./skyvern/skyvern-client.js";

export const USAGE = `Uso: checkin <comando> [opciones]

Comandos:
  run                 Hace el check-in de los pasajeros pendientes del manifiesto
  validate            Valida el manifiesto sin abrir ningún navegador
  skyvern-workflows   Lista los workflows publicados en Skyvern

Opciones:
  --manifest <ruta>   Manifiesto CSV (por defecto MANIFEST_PATH o data/passengers.csv)
  --airline <código>  Procesa solo una aerolínea: ${AIRLINES.join(" o ")}
  -h, --help          Muestra esta ayuda`;

export const EXIT = { ok: 0, failures: 1, usage: 2 } as const;

export interface Output {
  write(text: string): void;
}

class UsageError extends Error {}

function parseAirline(value: string | undefined): Airline | undefined {
  if (value === undefined) {
    return undefined;
  }
  const airline = AIRLINES.find((candidate) => candidate === value.toLowerCase());
  if (airline === undefined) {
    throw new UsageError(`aerolínea desconocida: ${value}`);
  }

  return airline;
}

async function validate(manifestPath: string, out: Output): Promise<number> {
  const rows = await CsvManifest.read(manifestPath);
  let invalid = 0;
  for (const [index, row] of rows.entries()) {
    const parsed = parsePassenger(row);
    const label = `Fila ${index + 2} (${row.reservation_code || "sin código"})`;
    if (parsed.ok) {
      out.write(`${label}: lista\n`);
    } else {
      invalid++;
      out.write(`${label}: ${parsed.errors.join("; ")}\n`);
    }
  }
  out.write(`\n${rows.length - invalid} de ${rows.length} pasajeros listos para el check-in.\n`);

  return invalid === 0 ? EXIT.ok : EXIT.failures;
}

async function run(config: Config, airline: Airline | undefined, logger: Logger, out: Output): Promise<number> {
  const manifest = await CsvManifest.open(config.manifestPath);
  try {
    const needsSkyvern = manifest.rows.some(
      (row) => row.airline.trim().toLowerCase() === "copa" && (airline === undefined || airline === "copa"),
    );
    if (needsSkyvern && config.skyvern.apiKey === "") {
      throw new UsageError("el manifiesto tiene pasajeros de Copa: configura SKYVERN_API_KEY");
    }
    const runner = new CheckInRunner(manifest, new AdapterRegistry(config, logger), logger, {
      maxAttempts: config.retry.maxAttempts,
      retryBaseDelayMs: config.retry.baseDelayMs,
      delayBetweenPassengersMs: config.delayBetweenPassengersMs,
      ...(airline === undefined ? {} : { airline }),
    });
    const summary = await runner.run();
    out.write(
      [
        "Resumen del check-in",
        `  Pasajeros en el manifiesto: ${summary.total}`,
        `  Exitosos:                   ${summary.succeeded}`,
        `  Con error:                  ${summary.failed}`,
        `  Omitidos:                   ${summary.skipped}`,
        `  Pasabordos en:              ${config.outputDir}`,
        "",
      ].join("\n"),
    );

    return summary.failed === 0 ? EXIT.ok : EXIT.failures;
  } finally {
    await manifest.close();
  }
}

async function listWorkflows(config: Config, logger: Logger, out: Output): Promise<number> {
  const workflows = await new SkyvernClient(config.skyvern, logger).listWorkflows();
  if (workflows.length === 0) {
    out.write("No hay workflows publicados en Skyvern.\n");
  }
  for (const workflow of workflows) {
    out.write(`${workflow.workflow_permanent_id}  ${workflow.title ?? "(sin título)"}\n`);
  }

  return EXIT.ok;
}

export async function runCli(argv: string[], environment: NodeJS.ProcessEnv, out: Output): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        manifest: { type: "string" },
        airline: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
    const [command] = positionals;
    if (values.help === true || command === undefined) {
      out.write(`${USAGE}\n`);

      return values.help === true ? EXIT.ok : EXIT.usage;
    }

    const config = loadConfig({
      ...environment,
      ...(values.manifest === undefined ? {} : { MANIFEST_PATH: values.manifest }),
    });
    const logger = createLogger(config.logLevel);
    switch (command) {
      case "validate":
        return await validate(config.manifestPath, out);
      case "run":
        return await run(config, parseAirline(values.airline), logger, out);
      case "skyvern-workflows":
        return await listWorkflows(config, logger, out);
      default:
        throw new UsageError(`comando desconocido: ${command}`);
    }
  } catch (error) {
    out.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    const badArguments = error instanceof TypeError && "code" in error;
    if (error instanceof UsageError || badArguments) {
      out.write(`\n${USAGE}\n`);
    }

    return EXIT.usage;
  }
}
