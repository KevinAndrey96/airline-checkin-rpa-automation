const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const config = require("../bot/config").load();
const CSVManager = require("../bot/csv");

const createMockLogger = () => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {}
});

describe("CSVManager with File Locking", () => {
  let tempDir;
  let testCsvPath;

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "checkin-csv-test-"));
    testCsvPath = path.join(tempDir, "passengers.test.csv");

    const sampleCsv = `airline,reservation_code,last_name,first_name,document_type,document_number,document_nationality,document_issuing_country,document_expiry_date,birth_date,gender,residence_country,visit_purpose,email,phone,emergency_contact_name,emergency_contact_phone_prefix,emergency_contact_phone,emergency_contact_country,seat_preference,checkin_status,checkin_date,error_message,attempt_count,last_attempt_date
avianca,AV999Z,MARTINEZ,JUAN,CC,12345678,Colombia,Colombia,,1988-04-12,M,Colombia,Turismo,juan.martinez@example.com,+573001112233,Maria Martinez,+57,3112223344,Colombia,WINDOW,PENDING,,,0,
`;
    fs.writeFileSync(testCsvPath, sampleCsv, "utf-8");
  });

  after(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should acquire and release lock on the CSV file", async () => {
    const csvManager = new CSVManager(testCsvPath, config, createMockLogger());
    await csvManager.acquireLock();
    assert.ok(csvManager.lock !== null);

    await csvManager.releaseLock();
    assert.strictEqual(csvManager.lock, null);
  });

  it("should parse valid passenger rows from the CSV file", async () => {
    const csvManager = new CSVManager(testCsvPath, config, createMockLogger());
    const passengers = await csvManager.read();

    assert.strictEqual(passengers.length, 1);
    assert.strictEqual(passengers[0].reservation_code, "AV999Z");
    assert.strictEqual(passengers[0].last_name, "MARTINEZ");
    assert.strictEqual(passengers[0].email, "juan.martinez@example.com");
  });

  it("should transition passenger states correctly (progress, success, error)", () => {
    const csvManager = new CSVManager(testCsvPath, config, createMockLogger());
    const initialPassenger = {
      airline: "avianca",
      reservation_code: "AV999Z",
      attempt_count: 0,
      checkin_status: "PENDING"
    };

    const inProgress = csvManager.markAsInProgress(initialPassenger);
    assert.strictEqual(inProgress.checkin_status, "IN_PROGRESS");
    assert.strictEqual(inProgress.attempt_count, 1);
    assert.ok(inProgress.last_attempt_date);

    const success = csvManager.markAsSuccess(inProgress, "/path/to/bp.pdf");
    assert.strictEqual(success.checkin_status, "SUCCESS");
    assert.ok(success.checkin_date);

    const errored = csvManager.markAsError(inProgress, "Seat map closed", "ERR_CHECKIN_CLOSED");
    assert.strictEqual(errored.checkin_status, "ERROR");
    assert.ok(errored.error_message.includes("[ERR_CHECKIN_CLOSED]"));
  });

  it("should reset interrupted check-ins from IN_PROGRESS to PENDING", () => {
    const csvManager = new CSVManager(testCsvPath, config, createMockLogger());
    const list = [
      { checkin_status: "IN_PROGRESS", reservation_code: "AV1" },
      { checkin_status: "SUCCESS", reservation_code: "AV2" }
    ];

    const resetList = csvManager.resetInterruptedCheckIns(list);
    assert.strictEqual(resetList[0].checkin_status, "PENDING");
    assert.strictEqual(resetList[1].checkin_status, "SUCCESS");
  });
});
