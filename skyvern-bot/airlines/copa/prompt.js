const fs = require("fs");
const path = require("path");

const GENDER_LABELS = {
  M: "Masculino",
  F: "Femenino",
  X: "No especificado"
};

const SEAT_LABELS = {
  WINDOW: "ventana",
  AISLE: "pasillo",
  MIDDLE: "centro",
  NONE: "cualquier asiento disponible"
};

function formatPhone(prefix, phone) {
  const cleanPhone = String(phone || "").replace(/\s/g, "");
  const cleanPrefix = String(prefix || "").replace(/\s/g, "");
  if (!cleanPhone) return "";
  if (cleanPhone.startsWith("+")) return cleanPhone;
  if (cleanPrefix) return `${cleanPrefix}${cleanPhone}`;
  return cleanPhone;
}

function buildCopaCheckInPrompt(passenger, checkInUrl) {
  const gender = GENDER_LABELS[passenger.gender] || passenger.gender || "No especificado";
  const seat = SEAT_LABELS[passenger.seat_preference] || SEAT_LABELS.NONE;
  const emergencyPhone = formatPhone(
    passenger.emergency_contact_phone_prefix,
    passenger.emergency_contact_phone
  );

  return [
    `Completa el check-in web de Copa Airlines para un pasajero.`,
    ``,
    `URL inicial: ${checkInUrl}`,
    ``,
    `Datos de la reserva:`,
    `- Código de reserva (6 caracteres): ${passenger.reservation_code}`,
    `- Apellido(s) exactamente como en la reserva: ${passenger.last_name}`,
    `- Nombre(s): ${passenger.first_name}`,
    ``,
    `Datos del pasajero:`,
    `- Email: ${passenger.email}`,
    `- Teléfono: ${passenger.phone}`,
    `- Tipo documento: ${passenger.document_type}`,
    `- Número documento: ${passenger.document_number}`,
    `- Nacionalidad documento: ${passenger.document_nationality}`,
    `- País emisión documento: ${passenger.document_issuing_country}`,
    passenger.document_expiry_date
      ? `- Fecha vencimiento documento: ${passenger.document_expiry_date}`
      : null,
    passenger.birth_date ? `- Fecha nacimiento: ${passenger.birth_date}` : null,
    `- Género: ${gender}`,
    `- País residencia: ${passenger.residence_country}`,
    `- Propósito viaje: ${passenger.visit_purpose}`,
    passenger.emergency_contact_name
      ? `- Contacto emergencia: ${passenger.emergency_contact_name}, tel ${emergencyPhone}, país ${passenger.emergency_contact_country}`
      : null,
    `- Preferencia asiento: ${seat}`,
    ``,
    `Instrucciones:`,
    `1. Busca la reserva con el código y apellido.`,
    `2. Completa todos los formularios obligatorios con los datos anteriores.`,
    `3. Si aparece selección de asiento, elige según la preferencia indicada o cualquier asiento libre.`,
    `4. Acepta términos/políticas si se solicitan.`,
    `5. Descarga o guarda el pasabordo (boarding pass) en PDF si es posible.`,
    `6. Si el check-in ya estaba hecho, obtén o descarga el pasabordo existente.`,
    ``,
    `Detente cuando el pasabordo esté visible en pantalla o descargado.`,
    `Si hay un error irrecuperable (reserva no encontrada, check-in cerrado, vuelo no elegible), detente y reporta el motivo.`
  ]
    .filter(Boolean)
    .join("\n");
}

function buildExtractionSchema() {
  return {
    type: "object",
    properties: {
      check_in_completed: {
        type: "boolean",
        description: "True if web check-in was completed successfully"
      },
      boarding_pass_available: {
        type: "boolean",
        description: "True if boarding pass is visible or was downloaded"
      },
      reservation_code: { type: "string" },
      passenger_full_name: { type: "string" },
      flight_number: { type: "string" },
      departure_airport: { type: "string" },
      arrival_airport: { type: "string" },
      seat_number: { type: "string" },
      error_message: {
        type: "string",
        description: "Error reason if check-in could not be completed"
      }
    },
    required: ["check_in_completed", "boarding_pass_available"]
  };
}

function buildTaskRequest(passenger, config) {
  const checkInUrl = config.get("copa.checkInUrl");

  return {
    prompt: buildCopaCheckInPrompt(passenger, checkInUrl),
    url: checkInUrl,
    title: `Copa check-in ${passenger.reservation_code}`,
    engine: config.get("skyvern.engine"),
    proxy_location: config.get("skyvern.proxyLocation"),
    max_steps: config.get("skyvern.maxSteps"),
    data_extraction_schema: buildExtractionSchema()
  };
}

module.exports = {
  buildCopaCheckInPrompt,
  buildExtractionSchema,
  buildTaskRequest
};
