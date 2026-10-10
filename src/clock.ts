export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export class ManualClock implements Clock {
  #instant: Date;

  constructor(instant: Date | string) {
    this.#instant = new Date(instant);
  }

  now(): Date {
    return new Date(this.#instant);
  }

  set(instant: Date | string): void {
    this.#instant = new Date(instant);
  }
}
