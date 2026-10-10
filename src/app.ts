import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { systemClock, type Clock } from "./clock.ts";
import { InMemoryScriptRepository, type ScriptRepository } from "./repository.ts";
import {
  DomainError,
  approve,
  createScript,
  requestChanges,
  submitVersion,
  type DomainErrorCode,
  type Script,
} from "./script.ts";

export interface AppOptions {
  clock?: Clock;
  repository?: ScriptRepository;
  generateId?: () => string;
}

class NotFoundError extends Error {}

class InvalidBodyError extends Error {
  readonly issues: z.core.$ZodIssue[];

  constructor(issues: z.core.$ZodIssue[]) {
    super("request body is invalid");
    this.issues = issues;
  }
}

const statusByCode: Record<DomainErrorCode, number> = {
  empty_title: 400,
  empty_content: 400,
  reason_required: 400,
  invalid_deadline: 400,
  deadline_expired: 422,
  invalid_transition: 409,
  revision_closed: 409,
};

const createScriptBody = z.object({ title: z.string(), content: z.string() });
const changeRequestBody = z.object({ reason: z.string(), deadline: z.string() });
const versionBody = z.object({ content: z.string() });
const idParams = z.object({ id: z.string() });
const versionParams = z.object({ id: z.string(), number: z.coerce.number().int().positive() });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value ?? {});
  if (!result.success) throw new InvalidBodyError(result.error.issues);
  return result.data;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const clock = options.clock ?? systemClock;
  const repository = options.repository ?? new InMemoryScriptRepository();
  const generateId = options.generateId ?? randomUUID;
  const app = Fastify();

  const load = (id: string): Script => {
    const script = repository.find(id);
    if (!script) throw new NotFoundError(`script ${id} not found`);
    return script;
  };

  const update = (id: string, change: (script: Script, now: Date) => Script): Script => {
    const next = change(load(id), clock.now());
    repository.save(next);
    return next;
  };

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) {
      return reply.status(statusByCode[error.code]).send({ error: error.code, message: error.message });
    }
    if (error instanceof NotFoundError) {
      return reply.status(404).send({ error: "not_found", message: error.message });
    }
    if (error instanceof InvalidBodyError) {
      return reply.status(400).send({
        error: "invalid_body",
        message: error.message,
        issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    }
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    if (statusCode < 500) {
      return reply.status(statusCode).send({ error: "bad_request", message: (error as Error).message });
    }
    app.log.error(error);
    return reply.status(500).send({ error: "internal_error", message: "unexpected error" });
  });

  app.post("/scripts", async (request, reply) => {
    const body = parse(createScriptBody, request.body);
    const script = createScript({ id: generateId(), ...body, now: clock.now() });
    repository.save(script);
    return reply.status(201).send(script);
  });

  app.get("/scripts/:id", async (request) => {
    const { id } = parse(idParams, request.params);
    return load(id);
  });

  app.get("/scripts/:id/versions", async (request) => {
    const { id } = parse(idParams, request.params);
    return load(id).versions;
  });

  app.get("/scripts/:id/versions/:number", async (request) => {
    const { id, number } = parse(versionParams, request.params);
    const version = load(id).versions.find((candidate) => candidate.number === number);
    if (!version) throw new NotFoundError(`version ${number} of script ${id} not found`);
    return version;
  });

  app.post("/scripts/:id/change-requests", async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const body = parse(changeRequestBody, request.body);
    const script = update(id, (current, now) =>
      requestChanges(current, { id: generateId(), ...body, now }),
    );
    return reply.status(201).send(script);
  });

  app.post("/scripts/:id/versions", async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const body = parse(versionBody, request.body);
    const script = update(id, (current, now) => submitVersion(current, { ...body, now }));
    return reply.status(201).send(script);
  });

  app.post("/scripts/:id/approve", async (request) => {
    const { id } = parse(idParams, request.params);
    return update(id, (current, now) => approve(current, { now }));
  });

  return app;
}
