import { isCalendarDate, isDeadlineExpired } from "./deadline.ts";

export type ScriptStatus = "in_review" | "changes_requested" | "approved";

export interface ScriptVersion {
  readonly number: number;
  readonly content: string;
  readonly createdAt: string;
}

export interface ChangeRequest {
  readonly id: string;
  readonly versionNumber: number;
  readonly reason: string;
  readonly deadline: string;
  readonly requestedAt: string;
  readonly resolvedByVersion: number | null;
}

export interface Script {
  readonly id: string;
  readonly title: string;
  readonly status: ScriptStatus;
  readonly currentVersion: number;
  readonly versions: readonly ScriptVersion[];
  readonly changeRequests: readonly ChangeRequest[];
  readonly approvedVersion: number | null;
  readonly approvedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type DomainErrorCode =
  | "empty_title"
  | "empty_content"
  | "reason_required"
  | "invalid_deadline"
  | "deadline_expired"
  | "invalid_transition"
  | "revision_closed";

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

function requireText(value: string, code: DomainErrorCode, message: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new DomainError(code, message);
  return value;
}

function requireStatus(script: Script, expected: ScriptStatus, action: string): void {
  if (script.status === "approved") {
    throw new DomainError("revision_closed", `script ${script.id} is approved; revision is closed`);
  }
  if (script.status !== expected) {
    throw new DomainError(
      "invalid_transition",
      `cannot ${action} while script is ${script.status}; expected ${expected}`,
    );
  }
}

export function createScript(input: {
  id: string;
  title: string;
  content: string;
  now: Date;
}): Script {
  const at = input.now.toISOString();
  return {
    id: input.id,
    title: requireText(input.title, "empty_title", "title is required").trim(),
    status: "in_review",
    currentVersion: 1,
    versions: [
      {
        number: 1,
        content: requireText(input.content, "empty_content", "content is required"),
        createdAt: at,
      },
    ],
    changeRequests: [],
    approvedVersion: null,
    approvedAt: null,
    createdAt: at,
    updatedAt: at,
  };
}

export function requestChanges(
  script: Script,
  input: { id: string; reason: string; deadline: string; now: Date },
): Script {
  requireStatus(script, "in_review", "request changes");
  const reason = requireText(input.reason, "reason_required", "reason is required").trim();
  if (!isCalendarDate(input.deadline)) {
    throw new DomainError("invalid_deadline", "deadline must be a calendar day in YYYY-MM-DD format");
  }
  if (isDeadlineExpired(input.deadline, input.now)) {
    throw new DomainError(
      "deadline_expired",
      `deadline ${input.deadline} has already passed in America/Sao_Paulo`,
    );
  }
  const at = input.now.toISOString();
  return {
    ...script,
    status: "changes_requested",
    changeRequests: [
      ...script.changeRequests,
      {
        id: input.id,
        versionNumber: script.currentVersion,
        reason,
        deadline: input.deadline,
        requestedAt: at,
        resolvedByVersion: null,
      },
    ],
    updatedAt: at,
  };
}

export function submitVersion(script: Script, input: { content: string; now: Date }): Script {
  requireStatus(script, "changes_requested", "submit a new version");
  const content = requireText(input.content, "empty_content", "content is required");
  const at = input.now.toISOString();
  const number = script.currentVersion + 1;
  return {
    ...script,
    status: "in_review",
    currentVersion: number,
    versions: [...script.versions, { number, content, createdAt: at }],
    changeRequests: script.changeRequests.map((request) =>
      request.resolvedByVersion === null ? { ...request, resolvedByVersion: number } : request,
    ),
    updatedAt: at,
  };
}

export function approve(script: Script, input: { now: Date }): Script {
  requireStatus(script, "in_review", "approve");
  const at = input.now.toISOString();
  return {
    ...script,
    status: "approved",
    approvedVersion: script.currentVersion,
    approvedAt: at,
    updatedAt: at,
  };
}
