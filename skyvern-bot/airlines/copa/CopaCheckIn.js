const fs = require("fs");
const path = require("path");
const { buildTaskRequest } = require("./prompt");
const { buildWorkflowRunRequest } = require("./workflow");

class CopaCheckIn {
  constructor(config, logger, skyvernClient) {
    this.config = config;
    this.logger = logger;
    this.skyvernClient = skyvernClient;
    this.boardingPassDir = path.resolve(process.cwd(), config.get("copa.boardingPassDir"));
    this.mode = config.get("copa.mode") || "workflow";
  }

  async checkIn(passenger) {
    const useWorkflow = this.mode === "workflow" && Boolean(this.config.get("copa.workflowId"));

    if (useWorkflow) {
      return this.checkInViaWorkflow(passenger);
    }

    return this.checkInViaTask(passenger);
  }

  async checkInViaWorkflow(passenger) {
    const workflowRequest = buildWorkflowRunRequest(passenger, this.config);

    this.logger.info("submitting copa workflow to skyvern", {
      reservation: passenger.reservation_code,
      workflowId: workflowRequest.workflow_id,
      runWith: workflowRequest.run_with,
      parameters: workflowRequest.parameters
    });

    const run = await this.skyvernClient.runWorkflowAndWait(workflowRequest);
    const artifactPath = await this.saveArtifacts(passenger, run);
    const result = this.evaluateRun(run, artifactPath, { workflow: true });

    return {
      runId: run.run_id,
      runType: run.run_type,
      status: run.status,
      output: run.output,
      downloadedFiles: run.downloaded_files || [],
      recordingUrl: run.recording_url,
      failureReason: run.failure_reason,
      ...result
    };
  }

  async checkInViaTask(passenger) {
    const taskRequest = buildTaskRequest(passenger, this.config);

    this.logger.info("submitting copa check-in task to skyvern", {
      reservation: passenger.reservation_code,
      url: taskRequest.url,
      maxSteps: taskRequest.max_steps
    });

    const run = await this.skyvernClient.runTaskAndWait(taskRequest);
    const artifactPath = await this.saveArtifacts(passenger, run);
    const result = this.evaluateRun(run, artifactPath, { workflow: false });

    return {
      runId: run.run_id,
      runType: run.run_type,
      status: run.status,
      output: run.output,
      downloadedFiles: run.downloaded_files || [],
      recordingUrl: run.recording_url,
      failureReason: run.failure_reason,
      ...result
    };
  }

  evaluateRun(run, artifactPath, { workflow }) {
    if (run.status !== "completed") {
      return {
        success: false,
        errorCode: `ERR_SKYVERN_${run.status.toUpperCase()}`,
        errorMessage: run.failure_reason || `Skyvern run ended with status: ${run.status}`
      };
    }

    if (workflow) {
      return {
        success: true,
        boardingPassPath: artifactPath,
        checkInCompleted: true,
        boardingPassAvailable: Boolean(artifactPath)
      };
    }

    const output = run.output || {};
    const hasDownload =
      Array.isArray(run.downloaded_files) && run.downloaded_files.length > 0;
    const boardingPassAvailable =
      output.boarding_pass_available === true || hasDownload || Boolean(artifactPath);
    const checkInCompleted = output.check_in_completed === true || boardingPassAvailable;

    if (!checkInCompleted && !boardingPassAvailable) {
      return {
        success: false,
        errorCode: "ERR_CHECKIN_INCOMPLETE",
        errorMessage:
          output.error_message ||
          "Check-in did not complete or boarding pass was not captured"
      };
    }

    return {
      success: true,
      boardingPassPath: artifactPath,
      checkInCompleted,
      boardingPassAvailable
    };
  }

  async saveArtifacts(passenger, run) {
    if (!fs.existsSync(this.boardingPassDir)) {
      fs.mkdirSync(this.boardingPassDir, { recursive: true });
    }

    const passengerDir = path.join(this.boardingPassDir, passenger.reservation_code);

    if (!fs.existsSync(passengerDir)) {
      fs.mkdirSync(passengerDir, { recursive: true });
    }

    const savedPaths = [];

    if (Array.isArray(run.downloaded_files)) {
      for (const file of run.downloaded_files) {
        const saved = await this.downloadFile(file, passengerDir, passenger);
        if (saved) savedPaths.push(saved);
      }
    }

    const metadataPath = path.join(passengerDir, "run-result.json");
    fs.writeFileSync(
      metadataPath,
      JSON.stringify(
        {
          run_id: run.run_id,
          run_type: run.run_type,
          status: run.status,
          output: run.output,
          failure_reason: run.failure_reason,
          recording_url: run.recording_url,
          saved_at: new Date().toISOString()
        },
        null,
        2
      )
    );

    return savedPaths[0] || metadataPath;
  }

  async downloadFile(fileInfo, passengerDir, passenger) {
    if (!fileInfo?.url) return null;

    try {
      const response = await fetch(fileInfo.url, {
        headers: { "x-api-key": this.config.get("skyvern.apiKey") }
      });

      if (!response.ok) {
        this.logger.warn("could not download skyvern file", {
          reservation: passenger.reservation_code,
          url: fileInfo.url,
          status: response.status
        });
        return null;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const filename =
        fileInfo.filename ||
        `boarding-pass-${passenger.reservation_code}${this.guessExtension(fileInfo.url)}`;
      const targetPath = path.join(passengerDir, filename);

      fs.writeFileSync(targetPath, buffer);
      this.logger.info("boarding pass saved", {
        reservation: passenger.reservation_code,
        path: targetPath
      });

      return targetPath;
    } catch (error) {
      this.logger.warn("file download failed", {
        reservation: passenger.reservation_code,
        error: error.message
      });
      return null;
    }
  }

  guessExtension(url) {
    if (url.includes(".pdf")) return ".pdf";
    if (url.includes(".png")) return ".png";
    return ".bin";
  }
}

module.exports = CopaCheckIn;
