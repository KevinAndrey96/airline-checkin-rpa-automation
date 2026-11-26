import { afterEach, describe, expect, it } from "vitest";
import {
  SkyvernClient,
  SkyvernRequestError,
  SkyvernRunTimeoutError,
  type SkyvernOptions,
} from "../../src/skyvern/skyvern-client.js";
import { json, startServer, type Handler, type TestServer } from "../support/http-server.js";
import { silentLogger } from "../support/rows.js";

const servers: TestServer[] = [];

async function serve(handler: Handler): Promise<TestServer> {
  const server = await startServer(handler);
  servers.push(server);

  return server;
}

function client(server: TestServer, overrides: Partial<SkyvernOptions> = {}): SkyvernClient {
  return new SkyvernClient(
    {
      apiUrl: `${server.url}/v1`,
      apiKey: "clave-de-prueba",
      pollIntervalMs: 5,
      runTimeoutMs: 1_000,
      retryBaseDelayMs: 1,
      ...overrides,
    },
    silentLogger,
  );
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("SkyvernClient", () => {
  it("starts a task and polls until it finishes", async () => {
    let polls = 0;
    const server = await serve((request, response) => {
      if (request.method === "POST") {
        json(response, 200, { run_id: "tsk_1", status: "created" });

        return;
      }
      polls++;
      json(response, 200, { run_id: "tsk_1", status: polls < 3 ? "running" : "completed", output: { ok: true } });
    });

    const run = await client(server).runTask({ prompt: "check-in" });

    expect(run).toMatchObject({ run_id: "tsk_1", status: "completed", output: { ok: true } });
    expect(server.requests[0]).toMatchObject({ method: "POST", url: "/v1/run/tasks" });
    expect(JSON.parse(server.requests[0]?.body ?? "{}")).toEqual({ prompt: "check-in" });
    expect(server.requests[0]?.headers["x-api-key"]).toBe("clave-de-prueba");
    expect(polls).toBe(3);
  });

  it("retries transient errors while polling", async () => {
    let calls = 0;
    const server = await serve((_request, response) => {
      calls++;
      if (calls < 3) {
        json(response, 500, { detail: "busy" });
      } else {
        json(response, 200, { run_id: "tsk_1", status: "completed" });
      }
    });

    await expect(client(server).getRun("tsk_1")).resolves.toMatchObject({ status: "completed" });
    expect(calls).toBe(3);
  });

  it("never retries a POST the server may have accepted", async () => {
    const server = await serve((_request, response) => {
      json(response, 500, { detail: "boom" });
    });

    await expect(client(server).runTask({})).rejects.toBeInstanceOf(SkyvernRequestError);
    expect(server.requests).toHaveLength(1);
  });

  it("retries a POST rejected with 503", async () => {
    let calls = 0;
    const server = await serve((request, response) => {
      calls++;
      if (request.method === "POST" && calls === 1) {
        json(response, 503, {});
      } else if (request.method === "POST") {
        json(response, 200, { run_id: "wr_1" });
      } else {
        json(response, 200, { run_id: "wr_1", status: "completed" });
      }
    });

    await expect(client(server).runWorkflow({ workflow_id: "wpid_1" })).resolves.toMatchObject({ run_id: "wr_1" });
    expect(server.requests.filter((request) => request.method === "POST")).toHaveLength(2);
  });

  it("does not retry client errors", async () => {
    const server = await serve((_request, response) => {
      json(response, 401, { detail: "invalid api key" });
    });

    await expect(client(server).getRun("tsk_1")).rejects.toThrow(/401/);
    expect(server.requests).toHaveLength(1);
  });

  it("gives up when the run does not finish in time", async () => {
    const server = await serve((request, response) => {
      json(response, 200, request.method === "POST" ? { run_id: "tsk_1" } : { run_id: "tsk_1", status: "running" });
    });

    await expect(client(server, { runTimeoutMs: 30 }).runTask({})).rejects.toBeInstanceOf(SkyvernRunTimeoutError);
  });

  it("sends the api key only to its own server when downloading", async () => {
    const own = await serve((_request, response) => {
      response.end("pdf-propio");
    });
    const storage = await serve((_request, response) => {
      response.end("pdf-externo");
    });
    const skyvern = client(own);

    await expect(skyvern.download(`${own.url}/v1/artifacts/1`)).resolves.toEqual(Buffer.from("pdf-propio"));
    await expect(skyvern.download(`${storage.url}/bucket/pasabordo.pdf`)).resolves.toEqual(Buffer.from("pdf-externo"));
    expect(own.requests[0]?.headers["x-api-key"]).toBe("clave-de-prueba");
    expect(storage.requests[0]?.headers["x-api-key"]).toBeUndefined();
  });

  it("lists the published workflows", async () => {
    const server = await serve((_request, response) => {
      json(response, 200, [{ workflow_permanent_id: "wpid_1", title: "CheckIn COPA" }]);
    });

    await expect(client(server).listWorkflows()).resolves.toEqual([
      { workflow_permanent_id: "wpid_1", title: "CheckIn COPA" },
    ]);
    expect(server.requests[0]?.url).toBe("/v1/workflows?page=1&page_size=50");
  });
});
