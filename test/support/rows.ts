import { pino } from "pino";
import { MANIFEST_COLUMNS, type ManifestRow, type Passenger, parsePassenger } from "../../src/domain/passenger.js";

export const silentLogger = pino({ level: "silent" });

export function row(overrides: Partial<ManifestRow> = {}): ManifestRow {
  const base: Partial<ManifestRow> = {
    airline: "avianca",
    reservation_code: "AV123X",
    last_name: "GOMEZ HERRERA",
    first_name: "ALEJANDRO",
    document_type: "CC",
    document_number: "1098765432",
    document_nationality: "Colombia",
    document_issuing_country: "Colombia",
    document_expiry_date: "",
    birth_date: "1992-05-14",
    gender: "M",
    residence_country: "Colombia",
    visit_purpose: "Turismo",
    email: "alejandro.gomez@example.com",
    phone: "+573001234567",
    emergency_contact_name: "Mariana Gomez",
    emergency_contact_phone_prefix: "+57",
    emergency_contact_phone: "3109876543",
    emergency_contact_country: "Colombia",
    seat_preference: "WINDOW",
    checkin_status: "PENDING",
    attempt_count: "0",
    ...overrides,
  };

  return Object.fromEntries(MANIFEST_COLUMNS.map((column) => [column, base[column] ?? ""])) as ManifestRow;
}

export function passenger(overrides: Partial<ManifestRow> = {}): Passenger {
  const parsed = parsePassenger(row(overrides));
  if (!parsed.ok) {
    throw new Error(`invalid test passenger: ${parsed.errors.join("; ")}`);
  }

  return parsed.passenger;
}
