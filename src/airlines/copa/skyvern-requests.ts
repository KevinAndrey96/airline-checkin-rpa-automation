import type { Passenger } from "../../domain/passenger.js";

const GENDER_LABELS = { M: "Masculino", F: "Femenino", X: "No especificado", "": "No especificado" } as const;
const SEAT_LABELS = { WINDOW: "ventana", AISLE: "pasillo", MIDDLE: "centro", NONE: "cualquiera", "": "cualquiera" } as const;

export interface TaskSettings {
  checkInUrl: string;
  engine: string;
  proxyLocation: string;
  maxSteps: number;
}

export interface WorkflowSettings {
  workflowId: string;
  proxyLocation: string;
}

/** Copa expects the surname without spaces, exactly as printed on the ticket. */
export function copaLastName(lastName: string): string {
  return lastName.trim().toUpperCase().replace(/\s+/g, "");
}

export function emergencyPhone(passenger: Passenger): string {
  return `${passenger.emergency_contact_phone_prefix}${passenger.emergency_contact_phone}`;
}

export function checkInPrompt(passenger: Passenger, checkInUrl: string): string {
  const lines = [
    "Completa el check-in web de Copa Airlines para un pasajero.",
    `URL inicial: ${checkInUrl}`,
    "",
    "Reserva:",
    `- Código de reserva: ${passenger.reservation_code}`,
    `- Apellido como aparece en la reserva: ${copaLastName(passenger.last_name)}`,
    `- Nombre: ${passenger.first_name}`,
    "",
    "Pasajero:",
    `- Correo: ${passenger.email}`,
    `- Teléfono: ${passenger.phone}`,
    `- Documento: ${passenger.document_type} ${passenger.document_number}, nacionalidad ${passenger.document_nationality}, expedido en ${passenger.document_issuing_country}`,
    passenger.document_expiry_date === "" ? "" : `- Vencimiento del documento: ${passenger.document_expiry_date}`,
    `- Fecha de nacimiento: ${passenger.birth_date}`,
    `- Género: ${GENDER_LABELS[passenger.gender]}`,
    `- País de residencia: ${passenger.residence_country}`,
    `- Propósito del viaje: ${passenger.visit_purpose}`,
    `- Contacto de emergencia: ${passenger.emergency_contact_name}, ${emergencyPhone(passenger)}, ${passenger.emergency_contact_country}`,
    `- Silla preferida: ${SEAT_LABELS[passenger.seat_preference]}`,
    "",
    "Instrucciones:",
    "1. Busca la reserva con el código y el apellido.",
    "2. Completa los formularios obligatorios con los datos anteriores.",
    "3. Si aparece la selección de silla, elige según la preferencia o una silla libre sin costo.",
    "4. Acepta términos y políticas cuando se soliciten. No pagues ningún servicio adicional.",
    "5. Descarga el pasabordo en PDF. Si el check-in ya estaba hecho, descarga el pasabordo existente.",
    "Detente cuando el pasabordo esté descargado o visible.",
    "Si hay un error irrecuperable (reserva no encontrada, check-in cerrado, pago exigido, documentos adicionales o CAPTCHA), detente y repórtalo en error_message.",
  ];

  return lines.filter((line, index) => line !== "" || lines[index - 1] !== "").join("\n");
}

export const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    check_in_completed: { type: "boolean", description: "True if the web check-in was completed" },
    boarding_pass_available: { type: "boolean", description: "True if the boarding pass is visible or downloaded" },
    flight_number: { type: "string" },
    seat_number: { type: "string" },
    error_message: { type: "string", description: "Reason when the check-in could not be completed" },
  },
  required: ["check_in_completed", "boarding_pass_available"],
} as const;

export function taskRequest(passenger: Passenger, settings: TaskSettings): Record<string, unknown> {
  return {
    title: `Copa check-in ${passenger.reservation_code}`,
    url: settings.checkInUrl,
    prompt: checkInPrompt(passenger, settings.checkInUrl),
    engine: settings.engine,
    proxy_location: settings.proxyLocation,
    max_steps: settings.maxSteps,
    data_extraction_schema: EXTRACTION_SCHEMA,
  };
}

export function workflowRequest(passenger: Passenger, settings: WorkflowSettings): Record<string, unknown> {
  return {
    workflow_id: settings.workflowId,
    title: `Copa check-in ${passenger.reservation_code}`,
    proxy_location: settings.proxyLocation,
    parameters: {
      reservation_code: passenger.reservation_code,
      last_name: copaLastName(passenger.last_name),
      first_name: passenger.first_name,
      email: passenger.email,
      phone: passenger.phone,
      seat_preference: passenger.seat_preference,
    },
  };
}
