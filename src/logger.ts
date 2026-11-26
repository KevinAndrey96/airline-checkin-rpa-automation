import { pino, type Level, type Logger } from "pino";

/** Personal data never reaches the logs, even when an object is logged by mistake. */
const REDACTED_FIELDS = [
  "document_number",
  "email",
  "phone",
  "birth_date",
  "emergency_contact_phone",
  "*.document_number",
  "*.email",
  "*.phone",
  "*.birth_date",
  "*.emergency_contact_phone",
  "apiKey",
  "*.apiKey",
];

/** JSON logs go to stderr so the human summary on stdout stays readable. */
export function createLogger(level: Level | "silent"): Logger {
  return pino(
    {
      level,
      base: { service: "airline-checkin-rpa" },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: REDACTED_FIELDS, censor: "[redactado]" },
    },
    pino.destination({ dest: 2, sync: true }),
  );
}
