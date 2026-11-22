const { describe, it } = require("node:test");
const assert = require("node:assert");
const config = require("../bot/config").load();
const {
  CheckInError,
  RecoverableError,
  PermanentError,
  ManualInterventionError,
  createErrorFromCode,
  categorizeError
} = require("../bot/errors");

describe("Error System & Classification", () => {
  it("should construct CheckInError subclasses with correct flags", () => {
    const recoverable = new RecoverableError("ERR_TIMEOUT", "Connection timed out");
    assert.strictEqual(recoverable.recoverable, true);
    assert.strictEqual(recoverable.name, "RecoverableError");

    const permanent = new PermanentError("ERR_RESERVATION_NOT_FOUND", "Reservation not found");
    assert.strictEqual(permanent.recoverable, false);
    assert.strictEqual(permanent.name, "PermanentError");

    const manual = new ManualInterventionError("ERR_CAPTCHA", "Captcha detected");
    assert.strictEqual(manual.recoverable, false);
    assert.strictEqual(manual.requiresManualIntervention, true);
    assert.strictEqual(manual.name, "ManualInterventionError");
  });

  it("should serialize CheckInError to JSON object", () => {
    const err = new RecoverableError("ERR_NETWORK", "Network glitch", {
      severity: "warn",
      userMessage: "Error de red temporal"
    });
    const json = err.toJSON();
    assert.strictEqual(json.code, "ERR_NETWORK");
    assert.strictEqual(json.recoverable, true);
    assert.strictEqual(json.userMessage, "Error de red temporal");
    assert.strictEqual(json.severity, "warn");
  });

  it("should create appropriate Error instance from error codes", () => {
    const timeoutErr = createErrorFromCode("ERR_TIMEOUT", config, "Gateway delay");
    assert.ok(timeoutErr instanceof RecoverableError);
    assert.strictEqual(timeoutErr.recoverable, true);
    assert.ok(timeoutErr.message.includes("Gateway delay"));

    const alreadyCheckedInErr = createErrorFromCode("ERR_ALREADY_CHECKED_IN", config);
    assert.ok(alreadyCheckedInErr instanceof PermanentError);
    assert.strictEqual(alreadyCheckedInErr.recoverable, false);

    const reservationErr = createErrorFromCode("ERR_RESERVATION_NOT_FOUND", config);
    assert.ok(reservationErr instanceof ManualInterventionError);
    assert.strictEqual(reservationErr.requiresManualIntervention, true);
  });

  it("should categorize generic Error exceptions based on message patterns", () => {
    const timeoutRaw = new Error("net::ERR_CONNECTION_TIMED_OUT on Avianca gateway");
    const categorizedTimeout = categorizeError(timeoutRaw, config);
    assert.strictEqual(categorizedTimeout.code, "ERR_NETWORK");

    const domRaw = new Error("waiting for selector '.pax-continue-btn' failed: timeout 30000ms");
    // Message contains "timeout" first or "waiting for selector"?
    // In categorizeError: timeout is checked first.
    const categorizedDom = categorizeError(domRaw, config);
    assert.strictEqual(categorizedDom.code, "ERR_TIMEOUT");

    const selectorRaw = new Error("waiting for selector '.seat-selection-modal' not found");
    const categorizedSelector = categorizeError(selectorRaw, config);
    assert.strictEqual(categorizedSelector.code, "ERR_DOM_CHANGED");

    const captchaRaw = new Error("Cloudflare turnstile captcha block encountered");
    const categorizedCaptcha = categorizeError(captchaRaw, config);
    assert.strictEqual(categorizedCaptcha.code, "ERR_CAPTCHA");
  });

  it("should preserve error context when categorizing existing CheckInError", () => {
    const existing = new RecoverableError("ERR_NETWORK", "Connection reset", {
      userMessage: "Fallo de conexion"
    });
    existing.context = "VENTANA 2: Datos de contacto";

    const categorized = categorizeError(existing, config);
    assert.strictEqual(categorized, existing);
    assert.ok(categorized.userMessage.includes("VENTANA 2: Datos de contacto"));
  });
});
