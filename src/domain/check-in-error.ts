/**
 * Every failure is reported with a stable code and a message in Spanish for the
 * travel agent. Retryable errors are attempted again with backoff; the rest need
 * a person to fix the data or finish the check-in manually.
 */
export const ERROR_CATALOG = {
  ERR_INVALID_DATA: { retryable: false, message: "Los datos del pasajero están incompletos o no son válidos" },
  ERR_RESERVATION_NOT_FOUND: {
    retryable: false,
    message: "La aerolínea no encontró la reserva con ese código y apellido",
  },
  ERR_CHECKIN_CLOSED: { retryable: false, message: "El check-in no está disponible para este vuelo" },
  ERR_FLIGHT_CANCELLED: { retryable: false, message: "El vuelo fue cancelado" },
  ERR_PAYMENT_REQUIRED: { retryable: false, message: "La aerolínea exige un pago; termine el check-in manualmente" },
  ERR_REQUIRES_DOCUMENTS: {
    retryable: false,
    message: "La aerolínea pide documentos adicionales; termine el check-in manualmente",
  },
  ERR_CAPTCHA: { retryable: false, message: "La aerolínea mostró un CAPTCHA; termine el check-in manualmente" },
  ERR_TIMEOUT: { retryable: true, message: "La página de la aerolínea no respondió a tiempo" },
  ERR_NETWORK: { retryable: true, message: "No hubo conexión con la aerolínea" },
  ERR_BOARDING_PASS_MISSING: { retryable: true, message: "El check-in terminó pero no se obtuvo el pasabordo" },
  ERR_AUTOMATION_FAILED: { retryable: true, message: "El agente de automatización no completó el check-in" },
  ERR_UNKNOWN: { retryable: true, message: "Ocurrió un error inesperado" },
} as const satisfies Record<string, { retryable: boolean; message: string }>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export class CheckInError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;

  constructor(code: ErrorCode, detail?: string, options?: ErrorOptions) {
    const { message, retryable } = ERROR_CATALOG[code];
    super(detail === undefined || detail === "" ? message : `${message}: ${detail}`, options);
    this.name = "CheckInError";
    this.code = code;
    this.retryable = retryable;
  }
}

const NETWORK_FAILURE = /net::ERR_|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed/i;

export function toCheckInError(error: unknown): CheckInError {
  if (error instanceof CheckInError) {
    return error;
  }
  if (!(error instanceof Error)) {
    return new CheckInError("ERR_UNKNOWN", String(error));
  }
  if (error.name === "TimeoutError") {
    return new CheckInError("ERR_TIMEOUT", undefined, { cause: error });
  }
  if (NETWORK_FAILURE.test(error.message)) {
    return new CheckInError("ERR_NETWORK", undefined, { cause: error });
  }

  return new CheckInError("ERR_UNKNOWN", error.message, { cause: error });
}

const AIRLINE_MESSAGE_RULES: readonly [RegExp, ErrorCode][] = [
  [/captcha|no eres un robot|not a robot/, "ERR_CAPTCHA"],
  [/cancelad|cancelled|canceled/, "ERR_FLIGHT_CANCELLED"],
  [/pago|payment|pagar/, "ERR_PAYMENT_REQUIRED"],
  [/documentos? adicional|additional document|visa/, "ERR_REQUIRES_DOCUMENTS"],
  [/cerrad|closed|aun no esta disponible|not yet available|fuera del horario/, "ERR_CHECKIN_CLOSED"],
  [/no encontr|no exist|not found|no es valid|invalid|reserva valid|apellido valid/, "ERR_RESERVATION_NOT_FOUND"],
];

/** Maps an error banner shown by the airline to the closest catalog code. */
export function classifyAirlineMessage(text: string): ErrorCode {
  const normalized = text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  const rule = AIRLINE_MESSAGE_RULES.find(([pattern]) => pattern.test(normalized));

  return rule ? rule[1] : "ERR_UNKNOWN";
}
