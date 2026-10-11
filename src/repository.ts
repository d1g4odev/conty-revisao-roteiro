import type { Script } from "./script.ts";

export interface ScriptRepository {
  find(id: string): Script | undefined;
  save(script: Script): void;
}

export class InMemoryScriptRepository implements ScriptRepository {
  readonly #scripts = new Map<string, Script>();

  find(id: string): Script | undefined {
    return this.#scripts.get(id);
  }

  save(script: Script): void {
    this.#scripts.set(script.id, script);
  }
}
