import { describe, expect, it } from "vitest";
import { calendarDateAt, isCalendarDate, isDeadlineExpired } from "../src/deadline.ts";

describe("calendarDateAt", () => {
  it("uses the America/Sao_Paulo calendar day, not the UTC one", () => {
    expect(calendarDateAt(new Date("2026-10-16T02:59:59.999Z"))).toBe("2026-10-15");
    expect(calendarDateAt(new Date("2026-10-16T03:00:00.000Z"))).toBe("2026-10-16");
  });

  it("follows the historical daylight saving offset", () => {
    expect(calendarDateAt(new Date("2018-12-02T01:59:59.999Z"))).toBe("2018-12-01");
    expect(calendarDateAt(new Date("2018-12-02T02:00:00.000Z"))).toBe("2018-12-02");
  });
});

describe("isCalendarDate", () => {
  it.each(["2026-10-15", "2028-02-29"])("accepts %s", (value) => {
    expect(isCalendarDate(value)).toBe(true);
  });

  it.each(["2026-02-30", "2027-02-29", "2026-13-01", "15/10/2026", "2026-10-15T23:59:59Z", ""])(
    "rejects %s",
    (value) => {
      expect(isCalendarDate(value)).toBe(false);
    },
  );
});

describe("isDeadlineExpired", () => {
  it("keeps the deadline valid through the last instant of the day", () => {
    expect(isDeadlineExpired("2026-10-15", new Date("2026-10-15T00:00:00.000-03:00"))).toBe(false);
    expect(isDeadlineExpired("2026-10-15", new Date("2026-10-15T23:59:59.999-03:00"))).toBe(false);
  });

  it("expires at the first instant of the next day", () => {
    expect(isDeadlineExpired("2026-10-15", new Date("2026-10-16T00:00:00.000-03:00"))).toBe(true);
  });
});
