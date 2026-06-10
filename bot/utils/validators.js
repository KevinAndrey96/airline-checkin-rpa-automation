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

const VALID_AIRLINES = ["avianca", "copa", "satena"];
const VALID_DOCUMENT_TYPES = ["CC", "CE", "PA", "TI", "NIT"];
const VALID_GENDERS = ["M", "F", "X", ""];
const VALID_SEAT_PREFERENCES = ["WINDOW", "AISLE", "MIDDLE", "NONE", ""];
const VALID_STATUSES = ["", "PENDING", "IN_PROGRESS", "SUCCESS", "ERROR"];

const passengerSchema = Joi.object({
  airline: Joi.string()
    .valid(...VALID_AIRLINES)
    .required()
    .messages({
      "any.only": "airline must be one of: " + VALID_AIRLINES.join(", "),
      "any.required": "airline is required"
    }),

  reservation_code: Joi.string()
    .trim()
    .min(5)
    .max(10)
    .alphanum()
    .uppercase()
    .required()
    .messages({
      "string.min": "reservation code must be at least 5 characters",
      "string.max": "reservation code must be at most 10 characters",
      "string.alphanum": "reservation code must contain only letters and numbers",
      "any.required": "reservation code is required"
    }),

  last_name: Joi.string()
    .trim()
    .min(2)
    .max(50)
    .pattern(/^[A-ZÁÉÍÓÚÑ\s]+$/)
    .uppercase()
    .required()
    .messages({
      "string.pattern.base": "last name must contain only letters and spaces",
      "any.required": "last name is required"
    }),

  first_name: Joi.string()
    .trim()
    .min(2)
    .max(50)
    .pattern(/^[A-ZÁÉÍÓÚÑ\s]+$/)
    .uppercase()
    .required()
    .messages({
      "string.pattern.base": "first name must contain only letters and spaces",
      "any.required": "first name is required"
    }),

  document_type: Joi.string()
    .valid(...VALID_DOCUMENT_TYPES)
    .required()
    .messages({
      "any.only": "document type must be one of: " + VALID_DOCUMENT_TYPES.join(", "),
      "any.required": "document type is required"
    }),

  document_number: Joi.string()
    .trim()
    .min(5)
    .max(20)
    .pattern(/^[A-Z0-9]+$/)
    .required()
    .messages({
      "string.pattern.base": "document number must contain only letters and numbers",
      "any.required": "document number is required"
    }),

  document_nationality: Joi.string()
    .trim()
    .min(2)
    .default("Colombia")
    .messages({
      "string.min": "document nationality must be at least 2 characters"
    }),

  document_issuing_country: Joi.string()
    .trim()
    .min(2)
    .default("Colombia")
    .messages({
      "string.min": "document issuing country must be at least 2 characters"
    }),

  document_expiry_date: Joi.date()
    .iso()
    .min("now")
    .allow("")
    .default("")
    .messages({
      "date.format": "document expiry date must be in format YYYY-MM-DD",
      "date.min": "document expiry date must be in the future"
    }),

  birth_date: Joi.date()
    .iso()
    .max("now")
    .min("1900-01-01")
    .required()
    .messages({
      "date.format": "birth date must be in format YYYY-MM-DD",
      "date.max": "birth date cannot be in the future",
      "any.required": "birth date is required"
    }),

  gender: Joi.string()
    .valid(...VALID_GENDERS)
    .allow("")
    .default("")
    .messages({
      "any.only": "gender must be one of: M (Masculino), F (Femenino), X (Sin especificar), or empty"
    }),

  residence_country: Joi.string()
    .trim()
    .min(2)
    .default("Colombia")
    .messages({
      "string.min": "residence country must be at least 2 characters"
    }),

  visit_purpose: Joi.string()
    .trim()
    .min(2)
    .default("Turismo")
    .messages({
      "string.min": "visit purpose must be at least 2 characters"
    }),

  email: Joi.string()
    .email()
    .required()
    .messages({
      "string.email": "email must be valid",
      "any.required": "email is required"
    }),

  phone: Joi.string()
    .trim()
    .pattern(/^[0-9+\s()-]+$/)
    .min(7)
    .max(20)
    .required()
    .messages({
      "string.pattern.base": "phone must contain only numbers, spaces, and +()-",
      "string.min": "phone must be at least 7 characters",
      "any.required": "phone is required"
    }),

  emergency_contact_name: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .allow("")
    .default("")
    .messages({
      "string.min": "emergency contact name must be at least 2 characters"
    }),

  emergency_contact_phone_prefix: Joi.string()
    .trim()
    .allow("")
    .default("+57")
    .messages({}),

  emergency_contact_phone: Joi.string()
    .trim()
    .pattern(/^[0-9+\s()-]+$/)
    .min(7)
    .max(20)
    .allow("")
    .default("")
    .messages({
      "string.pattern.base": "emergency contact phone must contain only numbers, spaces, and +()-"
    }),

  emergency_contact_country: Joi.string()
    .trim()
    .min(2)
    .allow("")
    .default("Colombia")
    .messages({
      "string.min": "emergency contact country must be at least 2 characters"
    }),

  seat_preference: Joi.string()
    .valid(...VALID_SEAT_PREFERENCES)
    .allow("")
    .default("NONE")
    .messages({
      "any.only": "seat preference must be one of: " + VALID_SEAT_PREFERENCES.join(", ")
    }),

  checkin_status: Joi.string()
    .valid(...VALID_STATUSES)
    .allow("")
    .default(""),

  checkin_date: Joi.string().allow("").default(""),

  error_message: Joi.string().allow("").default(""),

  attempt_count: Joi.number().integer().min(0).allow("").default(0),

  last_attempt_date: Joi.string().allow("").default("")
});

function validateCSVStructure(headers) {
  const missingColumns = REQUIRED_COLUMNS.filter(col => !headers.includes(col));

  if (missingColumns.length > 0) {
    return {
      valid: false,
      error: `missing required columns: ${missingColumns.join(", ")}`
    };
  }

  return { valid: true };
}

function validatePassenger(passenger, rowNumber) {
  const { error, value } = passengerSchema.validate(passenger, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    const errors = error.details.map(detail => detail.message).join("; ");
    return {
      valid: false,
      error: `row ${rowNumber}: ${errors}`,
      passenger: null
    };
  }

  return {
    valid: true,
    error: null,
    passenger: value
  };
}

function normalizePassenger(passenger) {
  return {
    ...passenger,
    airline: passenger.airline.toLowerCase().trim(),
    reservation_code: passenger.reservation_code.toUpperCase().trim(),
    last_name: passenger.last_name.toUpperCase().trim(),
    first_name: passenger.first_name.toUpperCase().trim(),
    document_type: passenger.document_type.toUpperCase().trim(),
    document_number: passenger.document_number.toUpperCase().trim(),
    document_nationality: String(passenger.document_nationality || "Colombia").trim(),
    document_issuing_country: String(passenger.document_issuing_country || "Colombia").trim(),
    document_expiry_date: String(passenger.document_expiry_date || "").trim(),
    birth_date: String(passenger.birth_date || "").trim(),
    gender: String(passenger.gender || "").toUpperCase().trim(),
    residence_country: String(passenger.residence_country || "Colombia").trim(),
    visit_purpose: String(passenger.visit_purpose || "Turismo").trim(),
    email: passenger.email.toLowerCase().trim(),
    phone: String(passenger.phone || "").trim(),
    emergency_contact_name: String(passenger.emergency_contact_name || "").trim(),
    emergency_contact_phone_prefix: String(passenger.emergency_contact_phone_prefix || "+57").trim(),
    emergency_contact_phone: String(passenger.emergency_contact_phone || "").trim(),
    emergency_contact_country: String(passenger.emergency_contact_country || "Colombia").trim(),
    seat_preference: passenger.seat_preference.toUpperCase().trim() || "NONE",
    checkin_status: passenger.checkin_status || "",
    checkin_date: passenger.checkin_date || "",
    error_message: passenger.error_message || "",
    attempt_count: parseInt(passenger.attempt_count, 10) || 0,
    last_attempt_date: passenger.last_attempt_date || ""
  };
}

function shouldProcessPassenger(passenger) {
  if (passenger.checkin_status === "SUCCESS") {
    return { process: false, reason: "already checked in successfully" };
  }

  if (passenger.checkin_status === "IN_PROGRESS") {
    return { process: true, reason: "resume interrupted check-in" };
  }

  // Procesar también los que tienen ERROR (el usuario ejecutará manualmente)
  if (passenger.checkin_status === "ERROR") {
    return { process: true, reason: "retrying failed check-in" };
  }

  return { process: true, reason: "pending check-in" };
}

module.exports = {
  REQUIRED_COLUMNS,
  VALID_AIRLINES,
  validateCSVStructure,
  validatePassenger,
  normalizePassenger,
  shouldProcessPassenger
};
