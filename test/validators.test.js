const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  validatePassenger,
  normalizePassenger,
  shouldProcessPassenger,
  validateCSVStructure,
  REQUIRED_COLUMNS
} = require("../bot/utils/validators");

describe("Passenger Validators", () => {
  const validPassenger = {
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
    checkin_date: "",
    error_message: "",
    attempt_count: "0",
    last_attempt_date: ""
  };

  it("should validate a complete and valid passenger record", () => {
    const result = validatePassenger(validPassenger, 1);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.error, null);
    assert.ok(result.passenger);
    assert.strictEqual(result.passenger.airline, "avianca");
  });

  it("should fail validation if email format is invalid", () => {
    const invalidPassenger = { ...validPassenger, email: "invalid-email-address" };
    const result = validatePassenger(invalidPassenger, 2);
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes("email must be valid"));
  });

  it("should fail validation if airline is unsupported", () => {
    const invalidPassenger = { ...validPassenger, airline: "lufthansa" };
    const result = validatePassenger(invalidPassenger, 3);
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes("airline must be one of"));
  });

  it("should normalize passenger strings to uppercase and trim spaces", () => {
    const rawPassenger = {
      ...validPassenger,
      reservation_code: "  av123x  ",
      last_name: "  gomez herrera  "
    };
    const normalized = normalizePassenger(rawPassenger);
    assert.strictEqual(normalized.reservation_code, "AV123X");
    assert.strictEqual(normalized.last_name, "GOMEZ HERRERA");
  });

  it("should determine if a passenger should be processed", () => {
    const pendingPassenger = { ...validPassenger, checkin_status: "PENDING" };
    assert.strictEqual(shouldProcessPassenger(pendingPassenger).process, true);

    const completedPassenger = { ...validPassenger, checkin_status: "SUCCESS" };
    assert.strictEqual(shouldProcessPassenger(completedPassenger).process, false);

    const errorPassenger = { ...validPassenger, checkin_status: "ERROR" };
    assert.strictEqual(shouldProcessPassenger(errorPassenger).process, true);
  });

  it("should validate CSV structure headers correctly", () => {
    const validHeaders = [...REQUIRED_COLUMNS];
    const validResult = validateCSVStructure(validHeaders);
    assert.strictEqual(validResult.valid, true);

    const incompleteHeaders = ["airline", "reservation_code"];
    const invalidResult = validateCSVStructure(incompleteHeaders);
    assert.strictEqual(invalidResult.valid, false);
    assert.ok(invalidResult.error.includes("missing required columns"));
  });
});
