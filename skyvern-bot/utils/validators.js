const Joi = require("joi");

const REQUIRED_COLUMNS = [
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
  "checkin_status",
  "checkin_date",
  "error_message",
  "attempt_count",
  "last_attempt_date"
];

const VALID_DOCUMENT_TYPES = ["CC", "CE", "PA", "TI", "NIT"];
const VALID_GENDERS = ["M", "F", "X", ""];
const VALID_SEAT_PREFERENCES = ["WINDOW", "AISLE", "MIDDLE", "NONE", ""];

const passengerSchema = Joi.object({
  airline: Joi.string().valid("copa").required(),
  reservation_code: Joi.string().trim().min(5).max(10).alphanum().uppercase().required(),
  last_name: Joi.string().trim().min(2).max(50).required(),
  first_name: Joi.string().trim().min(2).max(50).required(),
  document_type: Joi.string().valid(...VALID_DOCUMENT_TYPES).required(),
  document_number: Joi.string().trim().min(3).max(20).required(),
  document_nationality: Joi.string().trim().min(2).default("Colombia"),
  document_issuing_country: Joi.string().trim().min(2).default("Colombia"),
  document_expiry_date: Joi.string().allow("").default(""),
  birth_date: Joi.string().allow("").default(""),
  gender: Joi.string().valid(...VALID_GENDERS).default(""),
  residence_country: Joi.string().trim().min(2).default("Colombia"),
  visit_purpose: Joi.string().trim().min(2).default("Turismo"),
  email: Joi.string().email().required(),
  phone: Joi.string().trim().min(7).max(20).required(),
  emergency_contact_name: Joi.string().allow("").default(""),
  emergency_contact_phone_prefix: Joi.string().allow("").default("+57"),
  emergency_contact_phone: Joi.string().allow("").default(""),
  emergency_contact_country: Joi.string().allow("").default("Colombia"),
  seat_preference: Joi.string().valid(...VALID_SEAT_PREFERENCES).default("NONE"),
  checkin_status: Joi.string().allow("").default(""),
  checkin_date: Joi.string().allow("").default(""),
  error_message: Joi.string().allow("").default(""),
  attempt_count: Joi.number().integer().min(0).default(0),
  last_attempt_date: Joi.string().allow("").default("")
});

function validateCSVStructure(columns) {
  const missing = REQUIRED_COLUMNS.filter(col => !columns.includes(col));
  if (missing.length > 0) {
    return { valid: false, error: `missing CSV columns: ${missing.join(", ")}` };
  }
  return { valid: true };
}

function normalizePassenger(record) {
  let documentType = String(record.document_type || "").trim().toUpperCase();
  if (documentType === "PP") {
    documentType = "PA";
  }

  return {
    ...record,
    airline: String(record.airline || "").trim().toLowerCase(),
    reservation_code: String(record.reservation_code || "").trim().toUpperCase(),
    last_name: String(record.last_name || "").trim().toUpperCase(),
    first_name: String(record.first_name || "").trim().toUpperCase(),
    document_type: documentType,
    document_number: String(record.document_number || "").trim(),
    gender: String(record.gender || "").trim().toUpperCase(),
    seat_preference: String(record.seat_preference || "NONE").trim().toUpperCase(),
    checkin_status: String(record.checkin_status || "").trim().toUpperCase(),
    attempt_count: parseInt(record.attempt_count, 10) || 0
  };
}

function validatePassenger(passenger, rowNumber) {
  const { error, value } = passengerSchema.validate(passenger, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    return {
      valid: false,
      error: `row ${rowNumber}: ${error.details.map(d => d.message).join("; ")}`
    };
  }

  return { valid: true, passenger: value };
}

function shouldProcessPassenger(passenger) {
  if (passenger.airline !== "copa") {
    return { process: false, reason: "not a Copa passenger (skyvern-bot only processes copa)" };
  }

  if (passenger.checkin_status === "SUCCESS") {
    return { process: false, reason: "already checked in successfully" };
  }

  if (passenger.checkin_status === "IN_PROGRESS") {
    return { process: true, reason: "resume interrupted check-in" };
  }

  if (passenger.checkin_status === "ERROR") {
    return { process: true, reason: "retrying failed check-in" };
  }

  return { process: true, reason: "pending check-in" };
}

module.exports = {
  REQUIRED_COLUMNS,
  validateCSVStructure,
  normalizePassenger,
  validatePassenger,
  shouldProcessPassenger
};
