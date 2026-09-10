import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Flame,
  Lock,
  Pause,
  Pin,
  Play,
  RotateCcw,
  Unlock,
  X,
} from "lucide-react";
import {
  getClockSettings,
  patchClockSettings,
  CLOCK_GLASS_ALPHA,
} from "../services/clockService";
import { useFocusStore } from "../stores/focusStore";
import "../styles/clock.css";

const FLUSH_DELAY_MS = 300;
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const PRESET_MINUTES = [25, 45, 60];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 专注倒计时 MM:SS（不足一小时不补小时位，字号因此可以放得更大）。 */
function formatCountdown(totalSeconds: number): string {
  return `${pad(Math.floor(totalSeconds / 60))}:${pad(totalSeconds % 60)}`;
}

export function ClockApp() {
  const [now, setNow] = useState(() => Date.now());
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [locked, setLocked] = useState(false);
  const flushTimerRef = useRef<number | null>(null);

  // 专注状态机绑定
  const mode = useFocusStore((state) => state.mode);
  const durationMin = useFocusStore((state) => state.durationMin);
  const startFocus = useFocusStore((state) => state.start);
  const pauseFocus = useFocusStore((state) => state.pause);
  const resumeFocus = useFocusStore((state) => state.resume);
  const resetFocus = useFocusStore((state) => state.reset);
  const tickFocus = useFocusStore((state) => state.tick);
  const getRemaining = useFocusStore((state) => state.remaining);

  const isFocus = mode === "running" || mode === "paused";
  const isRunning = mode === "running";

  // 每秒跳动：推进一次 store.tick() 并刷新时间戳。
  // 剩余秒数刻意不做成 state —— 它在渲染期由 getRemaining() 现算：该值与
  // store 里记的 endAt 真实时间戳同源，后台节流 / 窗口隐藏都不会漂移，
  // 同时也避开了「在 effect 里同步 setState」这条 lint 规则。
  useEffect(() => {
    const timer = window.setInterval(() => {
      tickFocus();
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [tickFocus]);

  // 读取时钟设置，并确保根节点挂载 clock-entry
  useEffect(() => {
    document.documentElement.classList.add("clock-entry");
    void getClockSettings().then((s) => {
      setAlwaysOnTop(Boolean(s.alwaysOnTop));
      setLocked(Boolean(s.locked));
    });
  }, []);

  // 主题绑定：深浅切换时同步根节点属性与 CSS 玻璃浓度。
  // 不再调 set_clock_glass 开 SWCA 磨砂：SWCA 按窗口矩形绘制、无法随纸面
  // 20px 圆角裁形，磨砂会把挂件包进一个方角磨砂容器（2026-09-10 实机验证，
  // 窗口区域裁剪与 Win11 系统背景两条裁形路线对它都不生效）。CSS tint 是
  // 唯一玻璃层，clock.css 已按单层口径加深。
  useEffect(() => {
    const applyTheme = (dark: boolean) => {
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      document.documentElement.style.setProperty(
        "--clock-glass-alpha",
        String(CLOCK_GLASS_ALPHA),
      );
    };

    const root = document.documentElement;
    applyTheme(root.classList.contains("dark") || root.dataset.theme === "dark");

    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen<{ dark: boolean }>("app-theme-changed", (event) => {
      applyTheme(event.payload.dark);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  // 记忆桌面坐标与拉伸后的尺寸。两者共用同一个节流器：拖拽/拉伸过程中
  // 事件会高频触发，逐次写 IPC 会把 settings 表刷爆，只在动作停下后落一次盘。
  useEffect(() => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    const unlisteners: Array<() => void> = [];

    const flushLater = (patch: () => Promise<unknown>) => {
      if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = window.setTimeout(() => {
        void patch().catch((error) =>
          console.error("Failed to save clock geometry:", error),
        );
      }, FLUSH_DELAY_MS);
    };

    void appWindow
      .onMoved(({ payload: pos }) => {
        flushLater(async () => {
          const scale = await appWindow.scaleFactor();
          await patchClockSettings({ x: pos.x / scale, y: pos.y / scale });
        });
      })
      .then((fn) => unlisteners.push(fn));

    void appWindow
      .onResized(({ payload: size }) => {
        flushLater(async () => {
          const scale = await appWindow.scaleFactor();
          await patchClockSettings({ w: size.width / scale, h: size.height / scale });
        });
      })
      .then((fn) => unlisteners.push(fn));

    return () => {
      if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current);
      for (const off of unlisteners) off();
    };
  }, []);

  // 切换置顶
  async function handleToggleAlwaysOnTop() {
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    if (isTauri()) {
      try {
        await getCurrentWindow().setAlwaysOnTop(next);
      } catch (err) {
        console.error("Failed to set always on top:", err);
      }
    }
    await patchClockSettings({ alwaysOnTop: next });
  }

  // 切换锁定位置
  async function handleToggleLock() {
    const next = !locked;
    setLocked(next);
    await patchClockSettings({ locked: next });
  }

  // 关闭（隐藏）窗口
  async function handleClose() {
    if (isTauri()) {
      await getCurrentWindow().close();
    }
  }

  // 快速开启专注
  function handleStartFocus(minutes: number) {
    useFocusStore.getState().setDuration(minutes);
    startFocus();
  }

  // 读数来源：时间戳派生 Date，剩余秒数从 store 现算（不走 state）
  const time = new Date(now);
  const focusRemaining = getRemaining();

  const hours = pad(time.getHours());
  const minutes = pad(time.getMinutes());
  const seconds = pad(time.getSeconds());
  const dateLabel = `${time.getMonth() + 1}月${time.getDate()}日 ${WEEKDAYS[time.getDay()]}`;

  const totalSeconds = durationMin * 60;
  const progress =
    isFocus && totalSeconds > 0
      ? Math.max(0, Math.min(1, focusRemaining / totalSeconds))
      : 0;

  return (
    <main
      className={`clock-stage ${isFocus ? "is-focus" : ""}`}
      data-tauri-drag-region={locked ? "false" : "deep"}
    >
      <div className="clock-shell">
        {/* 悬停浮动工具条：绝对定位、零占位，移开鼠标即隐去 */}
        <div className="clock-toolbar" data-tauri-drag-region="false">
          <div className="clock-toolbar-slot">
            <button
              type="button"
              className={`clock-tool ${alwaysOnTop ? "is-on" : ""}`}
              onClick={() => void handleToggleAlwaysOnTop()}
              title={alwaysOnTop ? "取消置顶" : "置顶显示"}
            >
              <Pin size={12} />
            </button>
            <button
              type="button"
              className={`clock-tool ${locked ? "is-on" : ""}`}
              onClick={() => void handleToggleLock()}
              title={locked ? "解锁位置" : "锁定位置"}
            >
              {locked ? <Lock size={12} /> : <Unlock size={12} />}
            </button>
          </div>
          <div className="clock-toolbar-slot">
            <button
              type="button"
              className="clock-tool is-close"
              onClick={() => void handleClose()}
              title="收起时钟"
            >
              <X size={12} />
            </button>
          </div>
        </div>

        {/* 读数区：超大时间 + 次要说明，随窗口尺寸整体缩放 */}
        <div className="clock-readout">
          <div
            className="clock-time"
            data-tauri-drag-region="false"
            onClick={() => {
              if (!isFocus) handleStartFocus(25);
            }}
            title={isFocus ? undefined : "点击开始 25 分钟专注"}
          >
            {isFocus ? formatCountdown(focusRemaining) : `${hours}:${minutes}:${seconds}`}
          </div>
          <div className="clock-note">
            {isFocus ? (
              <>
                <Flame size={11} className="clock-note-flame" />
                <span>{isRunning ? "专注中" : "已暂停"}</span>
              </>
            ) : (
              <span>{dateLabel}</span>
            )}
          </div>
        </div>

        {/* 专注进度：贴着卡片底边的一根细线，替代原先的表盘圆环 */}
        {isFocus && (
          <div className="clock-progress" aria-hidden="true">
            <i
              className="clock-progress-fill"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        )}

        {/* 底部动作区：常态悬停浮现预设，专注态常驻控制按钮 */}
        <div className="clock-actions" data-tauri-drag-region="false">
          {isFocus ? (
            <>
              {isRunning ? (
                <button
                  type="button"
                  className="clock-action is-primary"
                  onClick={pauseFocus}
                  title="暂停"
                >
                  <Pause size={11} />
                  <span>暂停</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="clock-action is-primary"
                  onClick={resumeFocus}
                  title="继续"
                >
                  <Play size={11} />
                  <span>继续</span>
                </button>
              )}
              <button
                type="button"
                className="clock-action"
                onClick={resetFocus}
                title="结束本轮"
              >
                <RotateCcw size={11} />
                <span>结束</span>
              </button>
            </>
          ) : (
            PRESET_MINUTES.map((preset) => (
              <button
                key={preset}
                type="button"
                className="clock-action"
                onClick={() => handleStartFocus(preset)}
                title={`${preset} 分钟专注`}
              >
                {preset}m
              </button>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
