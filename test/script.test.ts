import { describe, expect, it } from "vitest";
import {
  DomainError,
  approve,
  createScript,
  requestChanges,
  submitVersion,
  type Script,
} from "../src/script.ts";

const now = new Date("2026-10-10T12:00:00.000-03:00");

function draft(): Script {
  return createScript({ id: "s1", title: "Unboxing", content: "v1", now });
}

function expectDomainError(action: () => unknown, code: DomainError["code"]): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`expected DomainError ${code}`);
}

describe("script review states", () => {
  it("starts in review with version 1", () => {
    const script = draft();
    expect(script.status).toBe("in_review");
    expect(script.currentVersion).toBe(1);
    expect(script.versions).toEqual([{ number: 1, content: "v1", createdAt: now.toISOString() }]);
  });

  it("moves to changes_requested with reason and deadline bound to the reviewed version", () => {
    const script = requestChanges(draft(), { id: "cr1", reason: "  Mention the coupon  ", deadline: "2026-10-15", now });
    expect(script.status).toBe("changes_requested");
    expect(script.changeRequests).toEqual([
      {
        id: "cr1",
        versionNumber: 1,
        reason: "Mention the coupon",
        deadline: "2026-10-15",
        requestedAt: now.toISOString(),
        resolvedByVersion: null,
      },
    ]);
  });

  it("returns to in_review with a new version and keeps the old one intact", () => {
    const requested = requestChanges(draft(), { id: "cr1", reason: "Shorter", deadline: "2026-10-15", now });
    const script = submitVersion(requested, { content: "v2", now });
    expect(script.status).toBe("in_review");
    expect(script.currentVersion).toBe(2);
    expect(script.versions.map((version) => version.content)).toEqual(["v1", "v2"]);
    expect(script.changeRequests[0]?.resolvedByVersion).toBe(2);
    expect(requested.versions).toHaveLength(1);
  });

  it("approves the current version and closes the revision", () => {
    const requested = requestChanges(draft(), { id: "cr1", reason: "Shorter", deadline: "2026-10-15", now });
    const script = approve(submitVersion(requested, { content: "v2", now }), { now });
    expect(script.status).toBe("approved");
    expect(script.approvedVersion).toBe(2);
    expect(script.approvedAt).toBe(now.toISOString());
  });

  it("does not reopen an approved script", () => {
    const approved = approve(draft(), { now });
    expectDomainError(() => requestChanges(approved, { id: "cr", reason: "x", deadline: "2026-10-15", now }), "revision_closed");
    expectDomainError(() => submitVersion(approved, { content: "v2", now }), "revision_closed");
    expectDomainError(() => approve(approved, { now }), "revision_closed");
  });

  it("rejects transitions that do not match the current state", () => {
    expectDomainError(() => submitVersion(draft(), { content: "v2", now }), "invalid_transition");
    const requested = requestChanges(draft(), { id: "cr1", reason: "Shorter", deadline: "2026-10-15", now });
    expectDomainError(() => approve(requested, { now }), "invalid_transition");
    expectDomainError(
      () => requestChanges(requested, { id: "cr2", reason: "Again", deadline: "2026-10-15", now }),
      "invalid_transition",
    );
  });

  it("requires a reason and a valid deadline", () => {
    expectDomainError(() => requestChanges(draft(), { id: "cr", reason: "   ", deadline: "2026-10-15", now }), "reason_required");
    expectDomainError(() => requestChanges(draft(), { id: "cr", reason: "x", deadline: "2026-02-30", now }), "invalid_deadline");
    expectDomainError(() => requestChanges(draft(), { id: "cr", reason: "x", deadline: "2026-10-09", now }), "deadline_expired");
  });

  it("accepts a deadline of today", () => {
    const script = requestChanges(draft(), { id: "cr", reason: "x", deadline: "2026-10-10", now });
    expect(script.status).toBe("changes_requested");
  });

  it("requires title and content", () => {
    expectDomainError(() => createScript({ id: "s", title: " ", content: "v1", now }), "empty_title");
    expectDomainError(() => createScript({ id: "s", title: "t", content: "\n", now }), "empty_content");
    const requested = requestChanges(draft(), { id: "cr", reason: "x", deadline: "2026-10-15", now });
    expectDomainError(() => submitVersion(requested, { content: "", now }), "empty_content");
  });
});
