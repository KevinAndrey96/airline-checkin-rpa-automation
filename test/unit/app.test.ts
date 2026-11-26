import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT, runCli } from "../../src/app.js";
import { serializeManifest } from "../../src/manifest/csv-manifest.js";
import { row } from "../support/rows.js";

async function cli(argv: string[], environment: NodeJS.ProcessEnv = {}) {
  let output = "";
  const code = await runCli(argv, { LOG_LEVEL: "silent", ...environment }, { write: (text) => (output += text) });

  return { code, output };
}

describe("checkin cli", () => {
  it("validates the example manifest shipped with the repo", async () => {
    const { code, output } = await cli(["validate", "--manifest", "examples/passengers.example.csv"]);

    expect(code).toBe(EXIT.ok);
    expect(output).toContain("3 de 3 pasajeros listos para el check-in.");
  });

  it("lists the problems of each invalid row", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "cli-")), "passengers.csv");
    await writeFile(path, serializeManifest([row(), row({ reservation_code: "X", email: "sin-arroba" })]));

    const { code, output } = await cli(["validate", "--manifest", path]);

    expect(code).toBe(EXIT.failures);
    expect(output).toContain("Fila 3 (X): reservation_code:");
    expect(output).toContain("email: el correo no es válido");
  });

  it("refuses to run Copa passengers without a Skyvern key", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "cli-")), "passengers.csv");
    await writeFile(path, serializeManifest([row({ airline: "copa" })]));

    const { code, output } = await cli(["run", "--manifest", path]);

    expect(code).toBe(EXIT.usage);
    expect(output).toContain("configura SKYVERN_API_KEY");
  });

  it.each([
    [["borrar"], "comando desconocido: borrar"],
    [["run", "--airline", "satena"], "aerolínea desconocida: satena"],
    [["run", "--desconocida"], "Unknown option"],
  ])("rejects %j with usage help", async (argv, message) => {
    const { code, output } = await cli(argv, { MANIFEST_PATH: "examples/passengers.example.csv" });

    expect(code).toBe(EXIT.usage);
    expect(output).toContain(message);
    expect(output).toContain("Uso: checkin");
  });

  it("prints the help", async () => {
    await expect(cli(["--help"])).resolves.toMatchObject({ code: EXIT.ok, output: expect.stringContaining("Comandos:") as unknown });
  });
});
