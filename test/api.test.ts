import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { ManualClock } from "../src/clock.ts";

let clock: ManualClock;
let app: FastifyInstance;

beforeEach(() => {
  clock = new ManualClock("2026-10-10T09:00:00.000-03:00");
  let sequence = 0;
  app = buildApp({ clock, generateId: () => `id-${++sequence}` });
});

afterEach(async () => {
  await app.close();
});

async function createScript(): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/scripts",
    payload: { title: "Unboxing", content: "Hook + produto + CTA" },
  });
  expect(response.statusCode).toBe(201);
  return response.json().id;
}

function requestChanges(id: string, payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: `/scripts/${id}/change-requests`, payload });
}

describe("deadline boundary with controlled clock", () => {
  it("accepts a change request at the last instant of the deadline day", async () => {
    const id = await createScript();
    clock.set("2026-10-15T23:59:59.999-03:00");
    const response = await requestChanges(id, { reason: "Citar o cupom", deadline: "2026-10-15" });
    expect(response.statusCode).toBe(201);
    expect(response.json().status).toBe("changes_requested");
  });

  it("rejects a change request at the first instant of the next day", async () => {
    const id = await createScript();
    clock.set("2026-10-16T00:00:00.000-03:00");
    const response = await requestChanges(id, { reason: "Citar o cupom", deadline: "2026-10-15" });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: "deadline_expired",
      message: "deadline 2026-10-15 has already passed in America/Sao_Paulo",
    });
    const script = (await app.inject({ method: "GET", url: `/scripts/${id}` })).json();
    expect(script.status).toBe("in_review");
    expect(script.changeRequests).toEqual([]);
  });
});

describe("review flow over HTTP", () => {
  it("runs in_review -> changes_requested -> in_review -> approved keeping every version", async () => {
    const id = await createScript();

    const requested = await requestChanges(id, { reason: "Citar o cupom", deadline: "2026-10-12" });
    expect(requested.statusCode).toBe(201);
    expect(requested.json().changeRequests[0]).toMatchObject({ id: "id-2", versionNumber: 1, deadline: "2026-10-12" });

    clock.set("2026-10-11T14:00:00.000-03:00");
    const submitted = await app.inject({
      method: "POST",
      url: `/scripts/${id}/versions`,
      payload: { content: "Hook + produto + cupom CONTY10 + CTA" },
    });
    expect(submitted.statusCode).toBe(201);
    expect(submitted.json()).toMatchObject({ status: "in_review", currentVersion: 2 });

    clock.set("2026-10-11T18:00:00.000-03:00");
    const approved = await app.inject({ method: "POST", url: `/scripts/${id}/approve` });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({
      status: "approved",
      approvedVersion: 2,
      approvedAt: "2026-10-11T21:00:00.000Z",
    });

    const versions = await app.inject({ method: "GET", url: `/scripts/${id}/versions` });
    expect(versions.json()).toEqual([
      { number: 1, content: "Hook + produto + CTA", createdAt: "2026-10-10T12:00:00.000Z" },
      { number: 2, content: "Hook + produto + cupom CONTY10 + CTA", createdAt: "2026-10-11T17:00:00.000Z" },
    ]);
    const first = await app.inject({ method: "GET", url: `/scripts/${id}/versions/1` });
    expect(first.json().content).toBe("Hook + produto + CTA");
  });

  it("keeps an approved script closed", async () => {
    const id = await createScript();
    await app.inject({ method: "POST", url: `/scripts/${id}/approve` });

    const reopen = await requestChanges(id, { reason: "Mudei de ideia", deadline: "2026-10-20" });
    expect(reopen.statusCode).toBe(409);
    expect(reopen.json().error).toBe("revision_closed");

    const newVersion = await app.inject({ method: "POST", url: `/scripts/${id}/versions`, payload: { content: "v2" } });
    expect(newVersion.statusCode).toBe(409);

    const again = await app.inject({ method: "POST", url: `/scripts/${id}/approve` });
    expect(again.statusCode).toBe(409);
  });

  it("refuses a new version when no change was requested", async () => {
    const id = await createScript();
    const response = await app.inject({ method: "POST", url: `/scripts/${id}/versions`, payload: { content: "v2" } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("invalid_transition");
  });

  it("refuses approval while a change request is open", async () => {
    const id = await createScript();
    await requestChanges(id, { reason: "Citar o cupom", deadline: "2026-10-12" });
    const response = await app.inject({ method: "POST", url: `/scripts/${id}/approve` });
    expect(response.statusCode).toBe(409);
  });

  it("requires reason and deadline on change requests", async () => {
    const id = await createScript();
    const missing = await requestChanges(id, { reason: "Citar o cupom" });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error).toBe("invalid_body");

    const blank = await requestChanges(id, { reason: "  ", deadline: "2026-10-12" });
    expect(blank.statusCode).toBe(400);
    expect(blank.json().error).toBe("reason_required");

    const malformed = await requestChanges(id, { reason: "Citar o cupom", deadline: "12/10/2026" });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error).toBe("invalid_deadline");
  });

  it("returns 404 for unknown scripts and versions", async () => {
    expect((await app.inject({ method: "GET", url: "/scripts/nope" })).statusCode).toBe(404);
    const id = await createScript();
    expect((await app.inject({ method: "GET", url: `/scripts/${id}/versions/9` })).statusCode).toBe(404);
  });
});
