import { join } from "node:path";
import type { Passenger } from "../domain/passenger.js";

type PassengerName = Pick<Passenger, "airline" | "reservation_code" | "last_name" | "first_name">;

function safeSegment(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
}

/** boarding_passes/avianca/AV123X_GOMEZ-HERRERA_ALEJANDRO.png */
export function boardingPassFile(outputDir: string, passenger: PassengerName, extension: string): string {
  const name = [passenger.reservation_code, passenger.last_name, passenger.first_name].map(safeSegment).join("_");

  return join(outputDir, passenger.airline, `${name}.${extension}`);
}

/** boarding_passes/errores/avianca/AV123X_2026-11-26T15-04-05Z.png */
export function errorScreenshotFile(outputDir: string, passenger: PassengerName): string {
  const stamp = new Date().toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-");

  return join(outputDir, "errores", passenger.airline, `${safeSegment(passenger.reservation_code)}_${stamp}.png`);
}

/** Directory for every artifact of one Copa run. */
export function runDirectory(outputDir: string, passenger: PassengerName): string {
  return join(outputDir, passenger.airline, safeSegment(passenger.reservation_code));
}
