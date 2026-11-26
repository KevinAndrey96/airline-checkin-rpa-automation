import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { INPUT_COLUMNS } from "../../src/domain/passenger.js";
import { CsvManifest, parseManifest, serializeManifest } from "../../src/manifest/csv-manifest.js";
import { row } from "../support/rows.js";

describe("parseManifest", () => {
  it("fills status columns missing from manifests written by older versions", () => {
    const legacy = `${INPUT_COLUMNS.join(",")},checkin_status\n${INPUT_COLUMNS.map((column) => row()[column]).join(",")},PENDING\n`;

    const [first] = parseManifest(legacy);

    expect(first).toMatchObject({ reservation_code: "AV123X", checkin_status: "PENDING", boarding_pass: "", error_code: "" });
  });

  it("rejects a manifest without the passenger columns", () => {
    expect(() => parseManifest("airline,reservation_code\navianca,AV123X\n")).toThrow(/missing columns: last_name/);
  });

  it("accepts an empty manifest with a byte order mark", () => {
    expect(parseManifest("\uFEFF")).toEqual([]);
  });

  it("round-trips commas and quotes", () => {
    const original = [row({ error_message: 'paso "pasabordo", reintento' })];

    expect(parseManifest(serializeManifest(original))).toEqual(original);
  });
});

describe("CsvManifest", () => {
  let path: string;

  beforeEach(async () => {
    path = join(await mkdtemp(join(tmpdir(), "manifest-")), "passengers.csv");
    await writeFile(path, serializeManifest([row(), row({ reservation_code: "AV456Y" })]));
  });

  it("saves updates to disk", async () => {
    const manifest = await CsvManifest.open(path);
    manifest.update(1, { checkin_status: "SUCCESS", boarding_pass: "boarding_passes/avianca/x.png" });
    await manifest.save();
    await manifest.close();

    const saved = parseManifest(await readFile(path, "utf8"));
    expect(saved[1]).toMatchObject({ checkin_status: "SUCCESS", boarding_pass: "boarding_passes/avianca/x.png" });
    expect(saved[0]?.checkin_status).toBe("PENDING");
  });

  it("refuses a second run on the same manifest", async () => {
    const manifest = await CsvManifest.open(path);

    await expect(CsvManifest.open(path)).rejects.toThrow(/in use by another run/);
    await manifest.close();
    await expect(CsvManifest.open(path).then((again) => again.close())).resolves.toBeUndefined();
  });

  it("rejects updates to rows that do not exist", async () => {
    const manifest = await CsvManifest.open(path);

    expect(() => {
      manifest.update(5, { checkin_status: "SUCCESS" });
    }).toThrow(RangeError);
    await manifest.close();
  });
});
