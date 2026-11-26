import { z } from "zod";

export const AIRLINES = ["avianca", "copa"] as const;
export type Airline = (typeof AIRLINES)[number];

export const CHECK_IN_STATUSES = ["PENDING", "IN_PROGRESS", "SUCCESS", "ERROR"] as const;
export type CheckInStatus = (typeof CHECK_IN_STATUSES)[number];

/** Columns the travel agent fills in for each passenger. */
export const INPUT_COLUMNS = [
  "airline",
  "reservation_code",
  "last_name",
  "first_name",
  "document_type",
  "document_number",
  "document_nationality",
  "document_issuing_country",
  "document_expiry_date",
  "birth_date",
  "gender",
  "residence_country",
  "visit_purpose",
  "email",
  "phone",
  "emergency_contact_name",
  "emergency_contact_phone_prefix",
  "emergency_contact_phone",
  "emergency_contact_country",
  "seat_preference",
] as const;

/** Columns the bot writes back after every attempt. */
export const STATUS_COLUMNS = [
  "checkin_status",
  "checkin_date",
  "boarding_pass",
  "error_code",
  "error_message",
  "attempt_count",
  "last_attempt_date",
] as const;

export const MANIFEST_COLUMNS = [...INPUT_COLUMNS, ...STATUS_COLUMNS] as const;
export type ManifestColumn = (typeof MANIFEST_COLUMNS)[number];
export type ManifestRow = Record<ManifestColumn, string>;

export const VISIT_PURPOSES = ["Turismo", "Negocios", "Estudios", "Transito"] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);

  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

const isoDate = z.string().trim().refine(isCalendarDate, "debe ser una fecha válida con formato AAAA-MM-DD");
const optionalIsoDate = z.union([z.literal(""), isoDate]);
const required = (label: string) => z.string().trim().min(2, `${label} es obligatorio`);

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

export const passengerSchema = z
  .object({
    airline: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.enum(AIRLINES, { error: `aerolínea no soportada; usa ${AIRLINES.join(" o ")}` })),
    reservation_code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{5,10}$/, "el código de reserva tiene de 5 a 10 letras o números"),
    last_name: required("el apellido"),
    first_name: required("el nombre"),
    document_type: z.enum(["CC", "CE", "PA", "TI"], { error: "el tipo de documento debe ser CC, CE, PA o TI" }),
    document_number: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{4,20}$/, "el número de documento tiene de 4 a 20 letras o números"),
    document_nationality: required("la nacionalidad"),
    document_issuing_country: required("el país de expedición"),
    document_expiry_date: optionalIsoDate,
    birth_date: isoDate,
    gender: z.enum(["M", "F", "X", ""], { error: "el género debe ser M, F o X" }),
    residence_country: required("el país de residencia"),
    visit_purpose: z
      .string()
      .trim()
      .transform(capitalize)
      .pipe(z.enum(VISIT_PURPOSES, { error: `el propósito debe ser ${VISIT_PURPOSES.join(", ")}` })),
    email: z.string().trim().pipe(z.email("el correo no es válido")),
    phone: z
      .string()
      .trim()
      .regex(/^\+?\d{7,15}$/, "el teléfono debe tener de 7 a 15 dígitos"),
    emergency_contact_name: required("el contacto de emergencia"),
    emergency_contact_phone_prefix: z
      .string()
      .trim()
      .regex(/^\+\d{1,4}$/, "el indicativo debe tener el formato +57"),
    emergency_contact_phone: z
      .string()
      .trim()
      .regex(/^\d{7,12}$/, "el teléfono de emergencia debe tener de 7 a 12 dígitos"),
    emergency_contact_country: required("el país del contacto de emergencia"),
    seat_preference: z.enum(["WINDOW", "AISLE", "MIDDLE", "NONE", ""], {
      error: "la preferencia de silla debe ser WINDOW, AISLE, MIDDLE o NONE",
    }),
  })
  .superRefine((passenger, context) => {
    if (passenger.document_type === "PA" && passenger.document_expiry_date === "") {
      context.addIssue({
        code: "custom",
        path: ["document_expiry_date"],
        message: "el pasaporte requiere fecha de vencimiento",
      });
    }
    if (passenger.document_expiry_date !== "" && passenger.document_expiry_date <= passenger.birth_date) {
      context.addIssue({
        code: "custom",
        path: ["document_expiry_date"],
        message: "el vencimiento debe ser posterior a la fecha de nacimiento",
      });
    }
  });

export type Passenger = z.output<typeof passengerSchema>;

export type PassengerParseResult = { ok: true; passenger: Passenger } | { ok: false; errors: string[] };

export function parsePassenger(row: ManifestRow): PassengerParseResult {
  const result = passengerSchema.safeParse(row);
  if (result.success) {
    return { ok: true, passenger: result.data };
  }

  return {
    ok: false,
    errors: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
  };
}

export function passengerLabel(passenger: Pick<Passenger, "reservation_code" | "last_name">): string {
  return `${passenger.reservation_code} ${passenger.last_name}`;
}
