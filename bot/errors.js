class CheckInError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "CheckInError";
    this.code = code;
    this.recoverable = options.recoverable || false;
    this.requiresManualIntervention = options.requiresManualIntervention || false;
    this.severity = options.severity || "error";
    this.userMessage = options.userMessage || message;
    this.originalError = options.originalError || null;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CheckInError);
    }
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      userMessage: this.userMessage,
      recoverable: this.recoverable,
      requiresManualIntervention: this.requiresManualIntervention,
      severity: this.severity
    };
  }
}

class RecoverableError extends CheckInError {
  constructor(code, message, options = {}) {
    super(code, message, { ...options, recoverable: true });
    this.name = "RecoverableError";
  }
}

class PermanentError extends CheckInError {
  constructor(code, message, options = {}) {
    super(code, message, { ...options, recoverable: false });
    this.name = "PermanentError";
  }
}

class ManualInterventionError extends CheckInError {
  constructor(code, message, options = {}) {
    super(code, message, {
      ...options,
      recoverable: false,
      requiresManualIntervention: true
    });
    this.name = "ManualInterventionError";
  }
}

function createErrorFromCode(errorCode, config, additionalMessage = "") {
  const errorDef = config.getErrorCode(errorCode);

  const message = additionalMessage
    ? `${errorDef.message}: ${additionalMessage}`
    : errorDef.message;

  const options = {
    severity: errorDef.severity,
    recoverable: errorDef.recoverable,
    requiresManualIntervention: errorDef.requiresManualIntervention,
    userMessage: errorDef.userMessage
  };

  if (errorDef.recoverable) {
    return new RecoverableError(errorCode, message, options);
  }

  if (errorDef.requiresManualIntervention) {
    return new ManualInterventionError(errorCode, message, options);
  }

  return new PermanentError(errorCode, message, options);
}

function categorizeError(error, config) {
  if (error instanceof CheckInError) {
    // Preservar el contexto si existe
    if (error.context) {
      error.userMessage = error.userMessage ? `${error.userMessage} - ${error.context}` : error.context;
    }
    return error;
  }

  let categorizedError;
  const originalContext = error.context || "";

  if (error.message.includes("timeout") || error.message.includes("Timeout")) {
    categorizedError = createErrorFromCode("ERR_TIMEOUT", config, error.message);
  } else if (
    error.message.includes("net::") ||
    error.message.includes("Network") ||
    error.message.includes("connection")
  ) {
    categorizedError = createErrorFromCode("ERR_NETWORK", config, error.message);
  } else if (
    error.message.includes("waiting for selector") ||
    error.message.includes("not found")
  ) {
    categorizedError = createErrorFromCode("ERR_DOM_CHANGED", config, error.message);
  } else if (error.message.includes("captcha") || error.message.includes("CAPTCHA")) {
    categorizedError = createErrorFromCode("ERR_CAPTCHA", config, error.message);
  } else {
    categorizedError = createErrorFromCode("ERR_UNKNOWN", config, error.message);
  }

  // Preservar el contexto del error original
  if (originalContext) {
    categorizedError.context = originalContext;
    categorizedError.userMessage = `${categorizedError.userMessage} - ${originalContext}`;
  }

  return categorizedError;
}

module.exports = {
  CheckInError,
  RecoverableError,
  PermanentError,
  ManualInterventionError,
  createErrorFromCode,
  categorizeError
};
