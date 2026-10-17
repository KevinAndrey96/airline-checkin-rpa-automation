const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
const { stringify } = require("csv-stringify/sync");
const lockfile = require("proper-lockfile");
const {
  validateCSVStructure,
  validatePassenger,
  normalizePassenger,
  shouldProcessPassenger,
  REQUIRED_COLUMNS
} = require("../utils/validators");

class CSVManager {
  constructor(filePath, config, logger) {
    this.filePath = filePath;
    this.config = config;
    this.logger = logger;
    this.lock = null;
    this.airlineFilter = config.get("csv.airlineFilter");
  }

  async acquireLock() {
    this.lock = await lockfile.lock(this.filePath, {
      retries: { retries: 5, minTimeout: 100, maxTimeout: 1000 },
      stale: 30000
    });
  }

  async releaseLock() {
    if (this.lock) {
      try {
        await this.lock();
        this.lock = null;
      } catch (error) {
        this.logger.warn("releasing csv lock", { error: error.message });
      }
    }
  }

  async read() {
    if (!fs.existsSync(this.filePath)) {
      throw new Error(`CSV not found: ${this.filePath}`);
    }

    const content = fs.readFileSync(this.filePath, "utf-8");
    if (!content.trim()) {
      throw new Error("CSV file is empty");
    }

    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
      cast: false
    });

    if (records.length === 0) {
      throw new Error("no passenger records in CSV");
    }

    const structureValidation = validateCSVStructure(Object.keys(records[0]));
    if (!structureValidation.valid) {
      throw new Error(structureValidation.error);
    }

    const passengers = [];
    for (let i = 0; i < records.length; i++) {
      const normalized = normalizePassenger(records[i]);
      const validation = validatePassenger(normalized, i + 2);

      if (!validation.valid) {
        if (normalized.airline === this.airlineFilter) {
          this.logger.warn("invalid copa passenger skipped", {
            row: i + 2,
            error: validation.error
          });
        }
        continue;
      }

      passengers.push(validation.passenger);
    }

    return passengers;
  }

  async writePassengerAtIndex(index, passengerUpdates) {
    const fullContent = fs.readFileSync(this.filePath, "utf-8");
    const allRecords = parse(fullContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
      cast: false
    });

    if (index < 0 || index >= allRecords.length) {
      throw new Error(`invalid CSV row index: ${index}`);
    }

    allRecords[index] = { ...allRecords[index], ...passengerUpdates };

    const content = stringify(allRecords, {
      header: true,
      columns: REQUIRED_COLUMNS,
      quoted: false,
      quoted_empty: false
    });

    fs.writeFileSync(this.filePath, content, "utf-8");
  }

  markAsInProgress(passenger) {
    return {
      ...passenger,
      checkin_status: "IN_PROGRESS",
      attempt_count: (passenger.attempt_count || 0) + 1,
      last_attempt_date: new Date().toISOString()
    };
  }

  markAsSuccess(passenger) {
    return {
      ...passenger,
      checkin_status: "SUCCESS",
      checkin_date: new Date().toISOString(),
      error_message: ""
    };
  }

  markAsError(passenger, errorMessage) {
    return {
      ...passenger,
      checkin_status: "ERROR",
      error_message: errorMessage,
      last_attempt_date: new Date().toISOString()
    };
  }

  getProcessablePassengers(allRecords) {
    const fullContent = fs.existsSync(this.filePath)
      ? fs.readFileSync(this.filePath, "utf-8")
      : "";
    const allRows = fullContent
      ? parse(fullContent, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
          bom: true,
          relax_column_count: true,
          cast: false
        })
      : [];

    const processable = [];
    const skipped = [];

    for (let i = 0; i < allRows.length; i++) {
      const row = allRows[i];
      const airline = String(row.airline || "").trim().toLowerCase();

      if (airline !== this.airlineFilter) {
        continue;
      }

      const normalized = normalizePassenger(row);
      const validation = validatePassenger(normalized, i + 2);

      if (!validation.valid) {
        skipped.push({ index: i, passenger: normalized, reason: validation.error });
        continue;
      }

      const decision = shouldProcessPassenger(validation.passenger);
      if (decision.process) {
        processable.push({ passenger: validation.passenger, index: i });
      } else {
        skipped.push({ index: i, passenger: validation.passenger, reason: decision.reason });
        this.logger.info("passenger skipped", {
          reservation: validation.passenger.reservation_code,
          reason: decision.reason
        });
      }
    }

    return { processable, skipped };
  }

  resetInterruptedCheckIns(allRows) {
    let resetCount = 0;
    for (const row of allRows) {
      if (
        String(row.airline || "").trim().toLowerCase() === this.airlineFilter &&
        row.checkin_status === "IN_PROGRESS"
      ) {
        row.checkin_status = "PENDING";
        resetCount++;
      }
    }

    if (resetCount > 0) {
      this.logger.info("interrupted copa check-ins reset", { count: resetCount });
    }

    return allRows;
  }

  async persistResetInterrupted() {
    const fullContent = fs.readFileSync(this.filePath, "utf-8");
    const allRecords = parse(fullContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
      cast: false
    });

    const updated = this.resetInterruptedCheckIns(allRecords);

    const content = stringify(updated, {
      header: true,
      columns: REQUIRED_COLUMNS,
      quoted: false,
      quoted_empty: false
    });

    fs.writeFileSync(this.filePath, content, "utf-8");
  }
}

module.exports = CSVManager;
