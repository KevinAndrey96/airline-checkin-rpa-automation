const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
const { stringify } = require("csv-stringify/sync");
const lockfile = require("proper-lockfile");
const {
  validateCSVStructure,
  validatePassenger,
  normalizePassenger,
  shouldProcessPassenger
} = require("./utils/validators");

class CSVManager {
  constructor(filePath, config, logger) {
    this.filePath = filePath;
    this.config = config;
    this.logger = logger;
    this.lock = null;
  }

  async acquireLock() {
    try {
      this.lock = await lockfile.lock(this.filePath, {
        retries: {
          retries: 5,
          minTimeout: 100,
          maxTimeout: 1000
        },
        stale: 30000
      });
    } catch (error) {
      throw new Error(`acquiring lock on ${this.filePath}: ${error.message}`);
    }
  }

  async releaseLock() {
    if (this.lock) {
      try {
        await this.lock();
        this.logger.info("csv file unlocked", { file: this.filePath });
        this.lock = null;
      } catch (error) {
        this.logger.warn("releasing lock", { error: error.message });
      }
    }
  }

  async read() {
    try {
      if (!fs.existsSync(this.filePath)) {
        throw new Error(`file not found: ${this.filePath}`);
      }

      const content = fs.readFileSync(this.filePath, "utf-8");

      if (!content.trim()) {
        throw new Error("file is empty");
      }

      const records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
        relax_column_count: true,
        cast: false,
        encoding: this.config.get("csv.encoding")
      });

      if (records.length === 0) {
        throw new Error("no passenger records found");
      }

      const structureValidation = validateCSVStructure(Object.keys(records[0]));
      if (!structureValidation.valid) {
        throw new Error(structureValidation.error);
      }

      const passengers = [];
      const errors = [];

      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        if (record.birth_date && typeof record.birth_date !== "string") {
          record.birth_date = record.birth_date.toString();
        }
        const normalized = normalizePassenger(record);
        const validation = validatePassenger(normalized, i + 2);

        if (!validation.valid) {
          errors.push(validation.error);
          this.logger.warn("invalid passenger data", {
            row: i + 2,
            error: validation.error
          });
          continue;
        }

        passengers.push(validation.passenger);
      }

      if (errors.length > 0 && passengers.length === 0) {
        throw new Error(`all passengers have validation errors:\n${errors.join("\n")}`);
      }

      return passengers;
    } catch (error) {
      throw new Error(`reading csv: ${error.message}`);
    }
  }

  async write(passengers) {
    try {
      const safePassengers = passengers.map(p => {
        let birthDate = p.birth_date;
        if (birthDate) {
          if (typeof birthDate === "object" && birthDate instanceof Date) {
            const year = birthDate.getFullYear();
            const month = String(birthDate.getMonth() + 1).padStart(2, "0");
            const day = String(birthDate.getDate()).padStart(2, "0");
            birthDate = `${year}-${month}-${day}`;
          } else {
            birthDate = String(birthDate);
            if (birthDate.includes("GMT") || birthDate.includes("Standard Time")) {
              const dateObj = new Date(birthDate);
              const year = dateObj.getFullYear();
              const month = String(dateObj.getMonth() + 1).padStart(2, "0");
              const day = String(dateObj.getDate()).padStart(2, "0");
              birthDate = `${year}-${month}-${day}`;
            }
          }
        }

        return {
          airline: p.airline,
          reservation_code: p.reservation_code,
          last_name: p.last_name,
          first_name: p.first_name,
          document_type: p.document_type,
          document_number: p.document_number,
          document_nationality: p.document_nationality || "Colombia",
          document_issuing_country: p.document_issuing_country || "Colombia",
          document_expiry_date: p.document_expiry_date || "",
          birth_date: birthDate || "",
          gender: p.gender || "",
          residence_country: p.residence_country || "Colombia",
          visit_purpose: p.visit_purpose || "Turismo",
          email: p.email,
          phone: p.phone || "",
          emergency_contact_name: p.emergency_contact_name || "",
          emergency_contact_phone_prefix: p.emergency_contact_phone_prefix || "+57",
          emergency_contact_phone: p.emergency_contact_phone || "",
          emergency_contact_country: p.emergency_contact_country || "Colombia",
          seat_preference: p.seat_preference,
          checkin_status: p.checkin_status || "",
          checkin_date: p.checkin_date || "",
          error_message: p.error_message || "",
          attempt_count: p.attempt_count || "",
          last_attempt_date: p.last_attempt_date || ""
        };
      });

      const content = stringify(safePassengers, {
        header: true,
        columns: [
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
        ],
        quoted: false,
        quoted_empty: false
      });

      fs.writeFileSync(this.filePath, content, "utf-8");

      this.logger.info("csv file written", {
        file: this.filePath,
        passengers: passengers.length
      });
    } catch (error) {
      throw new Error(`writing csv: ${error.message}`);
    }
  }

  async backup() {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.logger.warn("csv file not found for backup", { file: this.filePath });
        return null;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = this.filePath.replace(".csv", `.backup.${timestamp}.csv`);

      fs.copyFileSync(this.filePath, backupPath);

      this.logger.info("csv backup created", { backup: backupPath });

      return backupPath;
    } catch (error) {
      this.logger.error("creating backup", { error: error.message });
      return null;
    }
  }

  async updatePassenger(passengers, index, updates) {
    try {
      if (index < 0 || index >= passengers.length) {
        throw new Error(`invalid passenger index: ${index}`);
      }

      passengers[index] = {
        ...passengers[index],
        ...updates
      };

      if (this.config.get("csv.incrementalSave")) {
        await this.write(passengers);
      }

      return passengers;
    } catch (error) {
      throw new Error(`updating passenger at index ${index}: ${error.message}`);
    }
  }

  markAsInProgress(passenger) {
    return {
      ...passenger,
      checkin_status: "IN_PROGRESS",
      attempt_count: passenger.attempt_count + 1,
      last_attempt_date: new Date().toISOString()
    };
  }

  markAsSuccess(passenger, pdfPath) {
    return {
      ...passenger,
      checkin_status: "SUCCESS",
      checkin_date: new Date().toISOString(),
      error_message: ""
    };
  }

  markAsError(passenger, errorMessage, errorCode) {
    return {
      ...passenger,
      checkin_status: "ERROR",
      error_message: `[${errorCode}] ${errorMessage}`,
      last_attempt_date: new Date().toISOString()
    };
  }

  getProcessablePassengers(passengers) {
    const processable = [];
    const skipped = [];

    for (let i = 0; i < passengers.length; i++) {
      const passenger = passengers[i];
      const decision = shouldProcessPassenger(passenger);

      if (decision.process) {
        processable.push({ passenger, index: i });
      } else {
        skipped.push({ passenger, index: i, reason: decision.reason });
        this.logger.info("passenger skipped", {
          reservation: passenger.reservation_code,
          reason: decision.reason
        });
      }
    }

    return { processable, skipped };
  }

  resetInterruptedCheckIns(passengers) {
    let resetCount = 0;

    for (const passenger of passengers) {
      if (passenger.checkin_status === "IN_PROGRESS") {
        passenger.checkin_status = "PENDING";
        resetCount++;
      }
    }

    if (resetCount > 0) {
      this.logger.info("interrupted check-ins reset", { count: resetCount });
    }

    return passengers;
  }
}

module.exports = CSVManager;
