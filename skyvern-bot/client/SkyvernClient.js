const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "terminated",
  "timed_out",
  "canceled"
]);

class SkyvernClient {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.baseUrl = config.get("skyvern.apiUrl").replace(/\/$/, "");
    this.apiKey = config.get("skyvern.apiKey");
    this.pollIntervalMs = config.get("skyvern.pollIntervalMs");
    this.taskTimeoutMs = config.get("skyvern.taskTimeoutMs");
  }

  headers() {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey
    };
  }

  async request(method, path, body) {
    const url = `${this.baseUrl}${path}`;
    const options = {
      method,
      headers: this.headers()
    };

    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const text = await response.text();
    let data = null;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    if (!response.ok) {
      const detail = data?.detail || data?.message || text || response.statusText;
      throw new Error(`Skyvern API ${method} ${path} → ${response.status}: ${detail}`);
    }

    return data;
  }

  async healthCheck() {
    try {
      await this.request("GET", "/runs?page=1&page_size=1");
      return true;
    } catch (error) {
      throw new Error(`Skyvern server unreachable at ${this.baseUrl}: ${error.message}`);
    }
  }

  async runTask(taskRequest) {
    return this.request("POST", "/run/tasks", taskRequest);
  }

  async getRun(runId) {
    return this.request("GET", `/runs/${runId}`);
  }

  async runTaskAndWait(taskRequest) {
    const started = await this.runTask(taskRequest);
    return this.waitForRun(started.run_id, "skyvern task");
  }

  async runWorkflow(workflowRequest) {
    return this.request("POST", "/run/workflows", workflowRequest);
  }

  async runWorkflowAndWait(workflowRequest) {
    const started = await this.runWorkflow(workflowRequest);
    return this.waitForRun(started.run_id, "skyvern workflow");
  }

  async waitForRun(runId, label) {
    if (!runId) {
      throw new Error("Skyvern did not return a run_id");
    }

    this.logger.info(`${label} started`, { runId });

    const deadline = Date.now() + this.taskTimeoutMs;
    let latest = { run_id: runId, status: "created" };

    while (!TERMINAL_STATUSES.has(latest.status)) {
      if (Date.now() > deadline) {
        throw new Error(`Skyvern run timed out after ${this.taskTimeoutMs}ms (run_id=${runId})`);
      }

      await this.delay(this.pollIntervalMs);
      latest = await this.getRun(runId);
      this.logger.debug(`${label} polling`, {
        runId,
        status: latest.status,
        runType: latest.run_type,
        stepCount: latest.step_count
      });
    }

    this.logger.info(`${label} finished`, {
      runId,
      status: latest.status,
      runType: latest.run_type,
      stepCount: latest.step_count,
      failureReason: latest.failure_reason
    });

    return latest;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = SkyvernClient;
