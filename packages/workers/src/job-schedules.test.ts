import { ScheduleAlreadyRunning } from "@temporalio/client";
import { describe, expect, it } from "vitest";
import {
  bootstrapJobSchedules,
  ensureTenantJobSchedules,
  loadScheduledJobsConfig,
  type ScheduleCreator,
  type ScheduledJobsConfig,
} from "./job-schedules.js";
import {
  qaSamplingScheduleId,
  retentionScheduleId,
} from "./workflows/scheduled-jobs-types.js";

const CONFIG: ScheduledJobsConfig = {
  enabled: true,
  qaSampling: { hour: 2, minute: 0 },
  retention: { hour: 2, minute: 30 },
};

interface CreatedSchedule {
  readonly scheduleId: string;
  readonly workflowType: unknown;
  readonly taskQueue: unknown;
  readonly args: unknown;
  readonly calendars: unknown;
}

function createFakeScheduleClient(): {
  client: ScheduleCreator;
  created: CreatedSchedule[];
} {
  const created: CreatedSchedule[] = [];
  const ids = new Set<string>();

  const client = {
    async create(options: {
      scheduleId: string;
      spec: { calendars?: unknown };
      action: { workflowType: unknown; taskQueue: unknown; args?: unknown };
    }) {
      if (ids.has(options.scheduleId)) {
        throw new ScheduleAlreadyRunning(
          "Schedule already exists",
          options.scheduleId,
        );
      }

      ids.add(options.scheduleId);
      created.push({
        scheduleId: options.scheduleId,
        workflowType: options.action.workflowType,
        taskQueue: options.action.taskQueue,
        args: options.action.args,
        calendars: options.spec.calendars,
      });

      return undefined as never;
    },
  } as ScheduleCreator;

  return { client, created };
}

describe("loadScheduledJobsConfig", () => {
  it("defaults to enabled with the documented UTC fire times", () => {
    const config = loadScheduledJobsConfig({} as NodeJS.ProcessEnv);

    expect(config.enabled).toBe(true);
    expect(config.qaSampling).toEqual({ hour: 2, minute: 0 });
    expect(config.retention).toEqual({ hour: 2, minute: 30 });
  });

  it("parses configured fire times", () => {
    const config = loadScheduledJobsConfig({
      SUPPORT_QA_SAMPLING_SCHEDULE_UTC: "23:15",
      SUPPORT_RETENTION_SCHEDULE_UTC: "00:45",
    } as NodeJS.ProcessEnv);

    expect(config.qaSampling).toEqual({ hour: 23, minute: 15 });
    expect(config.retention).toEqual({ hour: 0, minute: 45 });
  });

  it("supports the explicit disable switch", () => {
    const config = loadScheduledJobsConfig({
      SUPPORT_JOB_SCHEDULES: "disabled",
    } as NodeJS.ProcessEnv);

    expect(config.enabled).toBe(false);
  });

  it("collects every configuration problem into one error", () => {
    expect(() =>
      loadScheduledJobsConfig({
        SUPPORT_JOB_SCHEDULES: "sometimes",
        SUPPORT_QA_SAMPLING_SCHEDULE_UTC: "2am",
        SUPPORT_RETENTION_SCHEDULE_UTC: "25:00",
      } as NodeJS.ProcessEnv),
    ).toThrow(
      /SUPPORT_JOB_SCHEDULES[\s\S]*SUPPORT_QA_SAMPLING_SCHEDULE_UTC[\s\S]*SUPPORT_RETENTION_SCHEDULE_UTC/,
    );
  });
});

describe("ensureTenantJobSchedules", () => {
  it("creates one qa-sampling and one retention schedule per tenant", async () => {
    const { client, created } = createFakeScheduleClient();

    const result = await ensureTenantJobSchedules({
      scheduleClient: client,
      taskQueue: "support-ticket-lifecycle",
      tenantIds: ["ten_a", "ten_b"],
      config: CONFIG,
    });

    expect(result.created).toEqual([
      qaSamplingScheduleId("ten_a"),
      retentionScheduleId("ten_a"),
      qaSamplingScheduleId("ten_b"),
      retentionScheduleId("ten_b"),
    ]);
    expect(result.existing).toEqual([]);

    const qaSchedule = created.find(
      (schedule) => schedule.scheduleId === qaSamplingScheduleId("ten_a"),
    );
    expect(qaSchedule?.workflowType).toBe("qaSamplingJobWorkflow");
    expect(qaSchedule?.taskQueue).toBe("support-ticket-lifecycle");
    expect(qaSchedule?.args).toEqual([{ tenant_id: "ten_a" }]);
    expect(qaSchedule?.calendars).toMatchObject([{ hour: 2, minute: 0 }]);

    const retentionSchedule = created.find(
      (schedule) => schedule.scheduleId === retentionScheduleId("ten_a"),
    );
    expect(retentionSchedule?.workflowType).toBe("retentionJobWorkflow");
    expect(retentionSchedule?.calendars).toMatchObject([
      { hour: 2, minute: 30 },
    ]);
  });

  it("is idempotent: existing schedules are reported, not recreated or failed", async () => {
    const { client, created } = createFakeScheduleClient();

    const first = await ensureTenantJobSchedules({
      scheduleClient: client,
      taskQueue: "support-ticket-lifecycle",
      tenantIds: ["ten_a"],
      config: CONFIG,
    });
    const second = await ensureTenantJobSchedules({
      scheduleClient: client,
      taskQueue: "support-ticket-lifecycle",
      tenantIds: ["ten_a"],
      config: CONFIG,
    });

    expect(first.created).toHaveLength(2);
    expect(second.created).toEqual([]);
    expect(second.existing).toEqual([
      qaSamplingScheduleId("ten_a"),
      retentionScheduleId("ten_a"),
    ]);
    expect(created).toHaveLength(2);
  });

  it("propagates non-duplicate schedule failures", async () => {
    const failing = {
      async create() {
        throw new Error("temporal unavailable");
      },
    } as unknown as ScheduleCreator;

    await expect(
      ensureTenantJobSchedules({
        scheduleClient: failing,
        taskQueue: "support-ticket-lifecycle",
        tenantIds: ["ten_a"],
        config: CONFIG,
      }),
    ).rejects.toThrow("temporal unavailable");
  });
});

describe("bootstrapJobSchedules", () => {
  it("ensures schedules for every active tenant from the lister", async () => {
    const { client, created } = createFakeScheduleClient();
    let listerClosed = false;

    const result = await bootstrapJobSchedules({
      env: {
        TEMPORAL_TASK_QUEUE: "support-ticket-lifecycle",
      } as NodeJS.ProcessEnv,
      scheduleClient: client,
      tenantLister: {
        async listActiveTenantIds() {
          return ["ten_a", "ten_b"];
        },
        async close() {
          listerClosed = true;
        },
      },
    });

    expect(result.enabled).toBe(true);
    expect(result.tenants).toBe(2);
    expect(result.created).toHaveLength(4);
    expect(created).toHaveLength(4);
    // Injected listers are owned by the caller (mirrors the store contract).
    expect(listerClosed).toBe(false);
  });

  it("skips everything when disabled", async () => {
    const result = await bootstrapJobSchedules({
      env: { SUPPORT_JOB_SCHEDULES: "disabled" } as NodeJS.ProcessEnv,
      scheduleClient: createFakeScheduleClient().client,
      tenantLister: {
        async listActiveTenantIds() {
          throw new Error("should not be called");
        },
      },
    });

    expect(result).toEqual({
      enabled: false,
      tenants: 0,
      created: [],
      existing: [],
    });
  });
});
