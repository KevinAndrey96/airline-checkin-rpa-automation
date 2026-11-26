import { readFile, rename, writeFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import lockfile from "proper-lockfile";
import { INPUT_COLUMNS, MANIFEST_COLUMNS, type ManifestRow } from "../domain/passenger.js";

export interface Manifest {
  readonly rows: readonly ManifestRow[];
  update(index: number, patch: Partial<ManifestRow>): void;
  save(): Promise<void>;
}

const STALE_LOCK_MS = 10 * 60_000;

export function parseManifest(content: string): ManifestRow[] {
  const records = parse<Record<string, string>>(content, {
    columns: true,
    bom: true,
    trim: true,
    skip_empty_lines: true,
  });
  const header = Object.keys(records[0] ?? {});
  const missing = records.length === 0 ? [] : INPUT_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    throw new Error(`manifest is missing columns: ${missing.join(", ")}`);
  }

  return records.map(
    (record) => Object.fromEntries(MANIFEST_COLUMNS.map((column) => [column, record[column] ?? ""])) as ManifestRow,
  );
}

export function serializeManifest(rows: readonly ManifestRow[]): string {
  return stringify([...rows], { header: true, columns: [...MANIFEST_COLUMNS] });
}

/**
 * Passenger manifest stored as CSV. The file stays locked while a run is in
 * progress and every save goes through a temporary file, so an interrupted run
 * never leaves a half-written manifest behind.
 */
export class CsvManifest implements Manifest {
  private constructor(
    private readonly path: string,
    private readonly entries: ManifestRow[],
    private readonly release: () => Promise<void>,
  ) {}

  static async open(path: string): Promise<CsvManifest> {
    const content = await readFile(path, "utf8");
    const rows = parseManifest(content);
    const release = await lockfile.lock(path, { stale: STALE_LOCK_MS, retries: 0 }).catch((error: unknown) => {
      throw new Error(`manifest ${path} is in use by another run`, { cause: error });
    });

    return new CsvManifest(path, rows, release);
  }

  static async read(path: string): Promise<ManifestRow[]> {
    return parseManifest(await readFile(path, "utf8"));
  }

  get rows(): readonly ManifestRow[] {
    return this.entries;
  }

  update(index: number, patch: Partial<ManifestRow>): void {
    const row = this.entries[index];
    if (row === undefined) {
      throw new RangeError(`manifest has no row ${index}`);
    }
    this.entries[index] = { ...row, ...patch };
  }

  async save(): Promise<void> {
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, serializeManifest(this.entries), "utf8");
    await rename(temporary, this.path);
  }

  async close(): Promise<void> {
    await this.release();
  }
}
