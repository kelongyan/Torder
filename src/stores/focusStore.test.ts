import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { hydrateFocus, useFocusStore, type PersistedFocus } from "./focusStore";

/**
 * focusStore 状态机测试。计时以真实时间戳差实现，全部用 fake timers
 * （Vitest 4 需 { now } 配置对象）驱动时间前进。
 * node 环境无 localStorage，测试注入内存 stub。
 */

const NOW = new Date("2026-09-03T04:00:00.000Z").getTime();

function createStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, value),
  };
}

beforeAll(() => {
  if (typeof globalThis.localStorage === "undefined") {
    Object.defineProperty(globalThis, "localStorage", {
      value: createStorageStub(),
      configurable: true,
    });
  }
});

/** 相对当前 fake 时间前进（多次调用累加，避免绝对时间回退）。 */
function advance(ms: number) {
  vi.setSystemTime(Date.now() + ms);
}

function freshStore() {
  useFocusStore.setState({
    mode: "idle",
    durationMin: 25,
    endAt: null,
    remainingSec: 0,
    focusTaskId: null,
    startedAt: null,
    lastCompletedAt: null,
    now: NOW,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  localStorage.clear();
  freshStore();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("hydrateFocus 续时", () => {
  it("running 未到期 → 恢复 running 并保留 endAt", () => {
    const saved: PersistedFocus = {
      mode: "running",
      endAt: NOW + 10 * 60_000,
      remainingSec: 0,
      durationMin: 25,
      focusTaskId: "task-1",
      startedAt: NOW - 15 * 60_000,
    };
    const hydrated = hydrateFocus(saved, NOW);
    expect(hydrated.mode).toBe("running");
    expect(hydrated.endAt).toBe(NOW + 10 * 60_000);
    expect(hydrated.focusTaskId).toBe("task-1");
  });

  it("running 已过期 → 归 idle（不跨进程补发）", () => {
    const saved: PersistedFocus = {
      mode: "running",
      endAt: NOW - 1,
      remainingSec: 0,
      durationMin: 25,
      focusTaskId: null,
      startedAt: null,
    };
    expect(hydrateFocus(saved, NOW)).toMatchObject({
      mode: "idle",
      endAt: null,
    });
  });

  it("paused → 恢复冻结剩余秒数", () => {
    const saved: PersistedFocus = {
      mode: "paused",
      endAt: null,
      remainingSec: 42,
      durationMin: 25,
      focusTaskId: "task-9",
      startedAt: null,
    };
    const hydrated = hydrateFocus(saved, NOW);
    expect(hydrated.mode).toBe("paused");
    expect(hydrated.remainingSec).toBe(42);
    expect(hydrated.focusTaskId).toBe("task-9");
  });

  it("空/损坏 → 全部默认", () => {
    expect(hydrateFocus({}, NOW)).toEqual({});
  });
});

describe("计时状态机", () => {
  it("start 进入 running，剩余时长按分钟换算", () => {
    useFocusStore.getState().start("task-1");
    const state = useFocusStore.getState();
    expect(state.mode).toBe("running");
    expect(state.focusTaskId).toBe("task-1");
    expect(state.endAt).toBe(NOW + 25 * 60_000);
    expect(state.remaining()).toBe(25 * 60);
  });

  it("tick 推进 now，随真实时间剩余递减", () => {
    useFocusStore.getState().start();
    advance(60_000);
    useFocusStore.getState().tick();
    expect(useFocusStore.getState().remaining()).toBe(24 * 60);
    expect(useFocusStore.getState().now).toBe(NOW + 60_000);
  });

  it("到期 tick 幂等完成：idle + lastCompletedAt 置位一次", () => {
    useFocusStore.getState().start();
    advance(25 * 60_000 + 500);
    useFocusStore.getState().tick();
    const after = useFocusStore.getState();
    expect(after.mode).toBe("idle");
    expect(after.lastCompletedAt).toBe(NOW + 25 * 60_000 + 500);
    expect(after.remaining()).toBe(0);
    expect(useFocusStore.getState().now).toBe(NOW + 25 * 60_000 + 500);

    // 再次 tick 不重复置位
    advance(1_000);
    useFocusStore.getState().tick();
    expect(useFocusStore.getState().lastCompletedAt).toBe(
      NOW + 25 * 60_000 + 500,
    );
  });

  it("pause 冻结剩余；resume 按剩余续跑", () => {
    useFocusStore.getState().start();
    advance(10 * 60_000);
    useFocusStore.getState().tick();
    useFocusStore.getState().pause();
    let state = useFocusStore.getState();
    expect(state.mode).toBe("paused");
    expect(state.remainingSec).toBe(15 * 60);
    expect(state.endAt).toBeNull();

    advance(5 * 60_000); // 暂停期间时间流逝不影响剩余
    useFocusStore.getState().tick();
    expect(useFocusStore.getState().remaining()).toBe(15 * 60);

    useFocusStore.getState().resume();
    state = useFocusStore.getState();
    expect(state.mode).toBe("running");
    expect(state.remaining()).toBe(15 * 60);

    advance(15 * 60_000);
    useFocusStore.getState().tick();
    expect(useFocusStore.getState().mode).toBe("idle");
    expect(useFocusStore.getState().lastCompletedAt).not.toBeNull();
  });

  it("reset 清空回 idle 并移除持久化", () => {
    useFocusStore.getState().start();
    useFocusStore.getState().reset();
    const state = useFocusStore.getState();
    expect(state.mode).toBe("idle");
    expect(state.endAt).toBeNull();
    expect(state.focusTaskId).toBeNull();
    expect(localStorage.getItem("torder-focus")).toBeNull();
  });

  it("运行中 setDuration / setFocusTask 不生效（仅对下一轮）", () => {
    useFocusStore.getState().start();
    useFocusStore.getState().setDuration(50);
    useFocusStore.getState().setFocusTask("task-x");
    const state = useFocusStore.getState();
    expect(state.durationMin).toBe(25);
    expect(state.focusTaskId).toBeNull();

    useFocusStore.getState().pause();
    useFocusStore.getState().setDuration(50);
    expect(useFocusStore.getState().durationMin).toBe(25);
  });

  it("时长边界夹取（5–120 分钟）", () => {
    freshStore();
    useFocusStore.getState().setDuration(999);
    expect(useFocusStore.getState().durationMin).toBe(120);
    useFocusStore.getState().setDuration(1);
    expect(useFocusStore.getState().durationMin).toBe(5);
    useFocusStore.getState().setDuration(30.4);
    expect(useFocusStore.getState().durationMin).toBe(30);
  });
});

describe("持久化写入", () => {
  it("start 时写入 localStorage；tick 完成后清除", () => {
    useFocusStore.getState().start("task-2");
    const saved = JSON.parse(
      localStorage.getItem("torder-focus") ?? "{}",
    ) as PersistedFocus;
    expect(saved.mode).toBe("running");
    expect(saved.focusTaskId).toBe("task-2");

    advance(25 * 60_000);
    useFocusStore.getState().tick();
    expect(localStorage.getItem("torder-focus")).toBeNull();
  });
});
