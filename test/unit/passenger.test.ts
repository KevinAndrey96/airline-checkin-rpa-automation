import { describe, expect, it } from "vitest";
import { parsePassenger, type ManifestRow } from "../../src/domain/passenger.js";
import { row } from "../support/rows.js";

describe("parsePassenger", () => {
  it("accepts a complete row and normalizes it", () => {
    const parsed = parsePassenger(row({ airline: " Avianca ", reservation_code: "av123x", visit_purpose: "negocios" }));

    expect(parsed).toMatchObject({
      ok: true,
      passenger: { airline: "avianca", reservation_code: "AV123X", visit_purpose: "Negocios" },
    });
  });

  it.each<[string, Partial<ManifestRow>, string]>([
    ["unknown airline", { airline: "satena" }, "airline: aerolínea no soportada"],
    ["short reservation code", { reservation_code: "AB1" }, "reservation_code: el código de reserva"],
    ["reservation code with symbols", { reservation_code: "AV-123" }, "reservation_code:"],
    ["missing last name", { last_name: "" }, "last_name: el apellido es obligatorio"],
    ["unknown document type", { document_type: "NIT" }, "document_type:"],
    ["impossible birth date", { birth_date: "1992-02-30" }, "birth_date: debe ser una fecha válida"],
    ["passport without expiry", { document_type: "PA", document_number: "PA123456" }, "document_expiry_date: el pasaporte"],
    ["expiry before birth", { document_expiry_date: "1990-01-01" }, "document_expiry_date: el vencimiento"],
    ["invalid email", { email: "alejandro" }, "email: el correo no es válido"],
    ["phone with letters", { phone: "300-ABC" }, "phone:"],
    ["prefix without plus", { emergency_contact_phone_prefix: "57" }, "emergency_contact_phone_prefix:"],
    ["unknown purpose", { visit_purpose: "Trabajo" }, "visit_purpose:"],
    ["unknown seat", { seat_preference: "FRONT" }, "seat_preference:"],
  ])("rejects %s", (_case, overrides, expected) => {
    const parsed = parsePassenger(row(overrides));

    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? [] : parsed.errors.join(" | ")).toContain(expected);
  });

  it("reports every problem of a row at once", () => {
    const parsed = parsePassenger(row({ email: "", phone: "", last_name: "" }));

    expect(parsed.ok ? 0 : parsed.errors.length).toBe(3);
  });
});
