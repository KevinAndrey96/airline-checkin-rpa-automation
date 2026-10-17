/**
 * Mapeo CSV → parámetros del workflow Skyvern "CheckIn COPA".
 */

function formatCopaLastName(lastName) {
  return String(lastName || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function buildWorkflowParameters(passenger) {
  const lastName = formatCopaLastName(passenger.last_name);
  const reservationCode = String(passenger.reservation_code || "")
    .trim()
    .toUpperCase();

  return {
    // Nombres nuevos (script optimizado en workflows/copa/check_in_copa.py)
    last_name: lastName,
    reservation_code: reservationCode,
    // Nombres legacy generados por Skyvern UI (compatibilidad)
    cu_l_es_el_apellido_que_desea_ingresar: lastName,
    what_is_the_reservation_code: reservationCode
  };
}

function buildWorkflowRunRequest(passenger, config) {
  const workflowId = config.get("copa.workflowId");

  if (!workflowId) {
    throw new Error("COPA_SKYVERN_WORKFLOW_ID is not configured");
  }

  return {
    workflow_id: workflowId,
    title: `Copa check-in ${passenger.reservation_code}`,
    parameters: buildWorkflowParameters(passenger),
    proxy_location: config.get("skyvern.proxyLocation"),
    run_with: config.get("copa.workflowRunWith") || "code",
    ai_fallback: config.get("copa.workflowAiFallback") !== false
  };
}

module.exports = {
  formatCopaLastName,
  buildWorkflowParameters,
  buildWorkflowRunRequest
};
