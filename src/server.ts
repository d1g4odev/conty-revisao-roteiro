import { buildApp } from "./app.ts";

const app = buildApp();
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

await app.listen({ port, host });
console.log(`revisao-roteiro listening on http://${host}:${port}`);
