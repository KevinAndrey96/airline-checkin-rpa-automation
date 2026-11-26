import { describe, expect, it } from "vitest";
import { CheckInError, classifyAirlineMessage, toCheckInError, type ErrorCode } from "../../src/domain/check-in-error.js";

describe("classifyAirlineMessage", () => {
  it.each<[string, ErrorCode]>([
    ["No encontramos una reserva con esos datos", "ERR_RESERVATION_NOT_FOUND"],
    ["Ingresa un código de reserva válido", "ERR_RESERVATION_NOT_FOUND"],
    ["El check-in para este vuelo está cerrado", "ERR_CHECKIN_CLOSED"],
    ["El check-in aún no está disponible", "ERR_CHECKIN_CLOSED"],
    ["Tu vuelo fue cancelado", "ERR_FLIGHT_CANCELLED"],
    ["Para continuar debes realizar el pago", "ERR_PAYMENT_REQUIRED"],
    ["Se requieren documentos adicionales", "ERR_REQUIRES_DOCUMENTS"],
    ["Confirma que no eres un robot", "ERR_CAPTCHA"],
    ["Algo salió mal", "ERR_UNKNOWN"],
  ])("maps %j to %s", (message, code) => {
    expect(classifyAirlineMessage(message)).toBe(code);
  });
});

describe("toCheckInError", () => {
  it("keeps errors that already have a code", () => {
    const original = new CheckInError("ERR_CAPTCHA");

    expect(toCheckInError(original)).toBe(original);
  });

  it.each<[string, unknown, ErrorCode, boolean]>([
    ["playwright timeouts", Object.assign(new Error("Timeout 30000ms exceeded"), { name: "TimeoutError" }), "ERR_TIMEOUT", true],
    ["dns failures", new Error("page.goto: net::ERR_NAME_NOT_RESOLVED"), "ERR_NETWORK", true],
    ["fetch failures", new TypeError("fetch failed"), "ERR_NETWORK", true],
    ["anything else", new Error("boom"), "ERR_UNKNOWN", true],
    ["non errors", "boom", "ERR_UNKNOWN", true],
  ])("classifies %s", (_case, error, code, retryable) => {
    expect(toCheckInError(error)).toMatchObject({ code, retryable });
  });

  it("builds the message from the catalog and the detail", () => {
    expect(new CheckInError("ERR_TIMEOUT", "paso pasabordo").message).toBe(
      "La página de la aerolínea no respondió a tiempo: paso pasabordo",
    );
  });
});
