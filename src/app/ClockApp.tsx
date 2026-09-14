import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FocusEvent as ReactFocusEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Flame, Pencil } from "lucide-react";
import {
  getClockSettings,
  listenClockSettings,
  patchClockSettings,
  CLOCK_GLASS_ALPHA,
} from "../services/clockService";
import {
  FOCUS_MAX_SEC,
  useFocusStore,
} from "../stores/focusStore";
import "../styles/clock.css";

/* ===== 桌面时钟挂件（Clock Widget）=====
 *
 * 交互形态（2026-09-11 定稿）：一枚几乎隐形的编辑按钮 + 就地分段输入。
 *
 *   常态     显示当前时间。右上角铅笔按钮常态只有 25% 对比（几乎隐形），
 *            悬浮时浮出底色变明显。单击数字 = 用记忆时长直接开始专注。
 *   编辑态   点击铅笔进入：时长按「小时 : 分钟 : 秒」三段就地键入（2026-09-14
 *            由两段扩为三段），各带下划线（焦点段更实），中间淡化冒号隔开。
 *            值为 00 的段淡化显示。键入满两位自动跳下一段，←→ 或点击切换。
 *            Enter = 确认并开始计时；Esc / 停手超时 / 点击按钮 = 保留时长退出。
 *   专注中   倒计时。空格 = 暂停 ⇄ 继续，Esc = 结束本轮。
 *
 * 设计取舍记录：右键双击、滚轮、长按三代手势方案均被实测否决——隐藏式入口
 * 在挂件上可发现性太差、滚轮手感受设备差异不可控。可见但极克制的按钮 +
 * 原生 input 键入，是"可发现"与"物件感"之间能站住的平衡点。
 */

const FLUSH_DELAY_MS = 300;
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 编辑态停手超时：键入场景的思考间隙比滚动场景长，放宽到 8 秒。 */
const EDIT_IDLE_MS = 8000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 小时段上限（= FOCUS_MAX_SEC 折算），分钟/秒段上限 59。 */
const HOUR_MAX = Math.floor(FOCUS_MAX_SEC / 3600);

/** 专注倒计时：不足一小时 MM:SS（字号因此可以放得更大），≥1 小时补 H:
 *  （小时不补零——"2:00:00" 比 "02:00:00" 窄一档，最小窗宽下不溢出）。 */
function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  if (safe >= 3600) {
    return `${Math.floor(safe / 3600)}:${pad(Math.floor(safe / 60) % 60)}:${pad(safe % 60)}`;
  }
  return `${pad(Math.floor(safe / 60))}:${pad(safe % 60)}`;
}

function formatRemaining(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  if (safe < 60) return `${safe} 秒`;
  return `${Math.ceil(safe / 60)} 分钟`;
}

/** 只保留数字并截断到两位（分段输入的原始过滤）。 */
function digitsOf(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 2);
}

export function ClockApp() {
  const [now, setNow] = useState(() => Date.now());
  const [locked, setLocked] = useState(false);
  const [editing, setEditing] = useState(false);
  /** 分段输入的草稿：字符串形态（允许空串 = 输入中间态）。 */
  const [hourText, setHourText] = useState("00");
  const [minText, setMinText] = useState("25");
  const [secText, setSecText] = useState("00");

  const stageRef = useRef<HTMLElement | null>(null);
  const hourRef = useRef<HTMLInputElement | null>(null);
  const minRef = useRef<HTMLInputElement | null>(null);
  const secRef = useRef<HTMLInputElement | null>(null);
  const editBoxRef = useRef<HTMLDivElement | null>(null);
  const flushTimerRef = useRef<number | null>(null);

  // 专注状态机绑定
  const mode = useFocusStore((state) => state.mode);
  const durationSec = useFocusStore((state) => state.durationSec);
  const setDuration = useFocusStore((state) => state.setDuration);
  const startFocus = useFocusStore((state) => state.start);
  const pauseFocus = useFocusStore((state) => state.pause);
  const resumeFocus = useFocusStore((state) => state.resume);
  const resetFocus = useFocusStore((state) => state.reset);
  const tickFocus = useFocusStore((state) => state.tick);
  const getRemaining = useFocusStore((state) => state.remaining);

  const isFocus = mode === "running" || mode === "paused";
  const isRunning = mode === "running";

  /* ===== 分段值的解析与键入 ===== */

  const hourNum = parseInt(hourText, 10) || 0;
  const minNum = parseInt(minText, 10) || 0;
  const secNum = parseInt(secText, 10) || 0;

  /** 分段键入的统一规则（三段共用）：
   *  - 空串保持空（清空中间态）；
   *  - 单个数字原地保持——立即补零的话，下一次键入会被 digitsOf 截成
   *    前两位，新键入的数字被吞掉（无法输两位数的根因）；且首位就跳段
   *    会抢走用户还想键入的第二位；
   *  - 满两位才钳到段上限、规整回两位形态并跳下一段（末段无跳转）。
   *  段内上限只管本段（小时 2 / 分秒 59）；总量边界（5–120 分钟）不在
   *  键入时钳——退出/提交时 setDuration 统一夹取，编辑中途可见超界草稿。 */
  function segmentChange(
    raw: string,
    setText: (value: string | ((prev: string) => string)) => void,
    nextRef: { current: HTMLInputElement | null } | null,
    max: number,
  ) {
    const digits = digitsOf(raw);
    if (digits === "") {
      setText("");
      return;
    }
    if (digits.length === 2) {
      setText(pad(Math.min(parseInt(digits, 10), max)));
      nextRef?.current?.focus();
      nextRef?.current?.select();
    } else {
      setText(digits);
    }
  }

  /** 离开段位时把草稿规整回两位形态。必须用函数式更新：跳段引发的 blur
   *  与 onChange 同步触发，此刻闭包里的草稿还是旧值，直接读会把刚键入
   *  的段位覆盖回上一个值（小时键入 "1" 落库变 "00" 的根因）。 */
  function segmentBlur(
    setText: (value: string | ((prev: string) => string)) => void,
    max: number,
  ) {
    setText((prev) => pad(Math.min(parseInt(prev, 10) || 0, max)));
  }

  const handleHourChange = (raw: string) =>
    segmentChange(raw, setHourText, minRef, HOUR_MAX);
  const handleMinChange = (raw: string) =>
    segmentChange(raw, setMinText, secRef, 59);
  const handleSecChange = (raw: string) =>
    segmentChange(raw, setSecText, null, 59);
  const handleHourBlur = () => segmentBlur(setHourText, HOUR_MAX);
  const handleMinBlur = () => segmentBlur(setMinText, 59);
  const handleSecBlur = () => segmentBlur(setSecText, 59);

  function totalFromDraft(): number {
    return hourNum * 3600 + minNum * 60 + secNum;
  }

  /* ===== 编辑态进出 ===== */

  const enterEdit = useCallback(() => {
    setHourText(pad(Math.floor(durationSec / 3600)));
    setMinText(pad(Math.floor(durationSec / 60) % 60));
    setSecText(pad(durationSec % 60));
    setEditing(true);
  }, [durationSec]);

  /** Esc / 超时 / 再点铅笔：**保留**调好的时长（用户确实设过），不开始计时。
   *  总量边界（5–120 分钟）由 setDuration 统一夹取。 */
  const exitEdit = useCallback(() => {
    setDuration(totalFromDraft());
    setEditing(false);
    // hourText/minText/secText 参与时长计算但语义上是"当前草稿"而非依赖——
    // 该回调只在退出那一刻取一次值。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hourText, minText, secText, setDuration]);

  /** Enter：落盘时长并立刻开始计时。 */
  const commitEdit = useCallback(() => {
    setDuration(totalFromDraft());
    setEditing(false);
    startFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hourText, minText, secText, setDuration, startFocus]);

  // 进入编辑态后焦点默认落在分钟段（最常调的就是它），并全选便于直接覆盖。
  useEffect(() => {
    if (!editing) return;
    minRef.current?.focus();
    minRef.current?.select();
  }, [editing]);

  // 停手超时兜底：挂件的本职是显示时间，不能一直停在编辑态。
  // 每次键入都会重置（hourText/minText/secText 在依赖里）。
  useEffect(() => {
    if (!editing) return;
    const timer = window.setTimeout(exitEdit, EDIT_IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [editing, hourText, minText, secText, exitEdit]);

  // 两段间焦点都离开输入区（点到卡片空白等）时视为确认退出。
  // relatedTarget 还在编辑区内（自动跳段触发的那次 blur）则不退出。
  function handleEditBlur(event: ReactFocusEvent<HTMLDivElement>) {
    if (!editing) return;
    const next = event.relatedTarget;
    if (next instanceof Node && editBoxRef.current?.contains(next)) return;
    exitEdit();
  }

  // 键盘：编辑态 Enter/Esc/←→ 切段；专注态 空格/Esc。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (editing) {
        if (event.key === "Escape") {
          event.preventDefault();
          exitEdit();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          commitEdit();
          return;
        }
        if (event.key === "ArrowRight") {
          if (document.activeElement === hourRef.current) {
            event.preventDefault();
            minRef.current?.focus();
            minRef.current?.select();
          } else if (document.activeElement === minRef.current) {
            event.preventDefault();
            secRef.current?.focus();
            secRef.current?.select();
          }
        } else if (event.key === "ArrowLeft") {
          if (document.activeElement === secRef.current) {
            event.preventDefault();
            minRef.current?.focus();
            minRef.current?.select();
          } else if (document.activeElement === minRef.current) {
            event.preventDefault();
            hourRef.current?.focus();
            hourRef.current?.select();
          }
        }
        return;
      }
      if (isFocus) {
        if (event.key === "Escape") {
          event.preventDefault();
          resetFocus();
          return;
        }
        if (event.code === "Space") {
          event.preventDefault();
          if (isRunning) pauseFocus();
          else resumeFocus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    editing,
    isFocus,
    isRunning,
    exitEdit,
    commitEdit,
    resetFocus,
    pauseFocus,
    resumeFocus,
  ]);

  /* ===== 每秒跳动 ===== */
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

  /* ===== 设置读取与跨窗口同步 ===== */
  useEffect(() => {
    document.documentElement.classList.add("clock-entry");

    const adopt = (settings: {
      alwaysOnTop?: boolean | null;
      locked?: boolean | null;
    }) => {
      if (settings.alwaysOnTop !== undefined) {
        // 窗口行为的落地点在挂件这侧：设置页只写设置键 + 广播，
        // 真正的 setAlwaysOnTop 必须由本窗口执行（单一数据源，避免两处都写）。
        if (isTauri()) {
          void getCurrentWindow()
            .setAlwaysOnTop(Boolean(settings.alwaysOnTop))
            .catch(() => undefined);
        }
      }
      if (settings.locked !== undefined) {
        setLocked(Boolean(settings.locked));
      }
    };

    void getClockSettings().then(adopt).catch(() => undefined);
    return listenClockSettings(adopt);
  }, []);

  // 主题绑定：深浅切换时同步根节点属性与 CSS 玻璃浓度。
  // 不再调 set_clock_glass 开 SWCA 磨砂：SWCA 按窗口矩形绘制、无法随纸面
  // 20px 圆角裁形，磨砂会把挂件包进一个方角磨砂容器（2026-09-10 实机验证）。
  // CSS tint 是唯一玻璃层，clock.css 已按单层口径加深。
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
          await patchClockSettings({
            w: size.width / scale,
            h: size.height / scale,
          });
        });
      })
      .then((fn) => unlisteners.push(fn));

    return () => {
      if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current);
      for (const off of unlisteners) off();
    };
  }, []);

  /* ===== 指针 ===== */

  // 单击数字 = 用记忆时长直接开始专注（最常用的动作）。
  // 编辑态与专注态都不响应单击——编辑态的点击属于 input 与按钮。
  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || editing || isFocus) return;
    startFocus();
  }

  /* ===== 渲染 ===== */

  const time = new Date(now);
  const focusRemaining = getRemaining();

  const hours = pad(time.getHours());
  const minutes = pad(time.getMinutes());
  const seconds = pad(time.getSeconds());
  const dateLabel = `${time.getMonth() + 1}月${time.getDate()}日 ${WEEKDAYS[time.getDay()]}`;

  const totalSeconds = durationSec;
  const progress =
    isFocus && totalSeconds > 0
      ? Math.max(0, Math.min(1, focusRemaining / totalSeconds))
      : 0;

  // 秒只在"看时钟"的时候在场：编辑态看的是时长，专注态看的是倒计时。
  const showsSeconds = !editing && !isFocus;
  const timeText = isFocus
    ? formatCountdown(focusRemaining)
    : `${hours}:${minutes}`;

  // 状态行：正常态是日期，专注态是剩余时间；编辑态整行退场——
  // 只留分段输入，模式信号靠"界面净化"而不是靠加提示。
  const noteText = isFocus
    ? `${isRunning ? "专注" : "已暂停"} · 剩 ${formatRemaining(focusRemaining)}`
    : dateLabel;

  return (
    <main
      ref={stageRef}
      className={`clock-stage ${isFocus ? "is-focus" : ""} ${editing ? "is-editing" : ""}`}
      data-tauri-drag-region={locked ? "false" : "deep"}
    >
      <div className="clock-shell">
        {/* 编辑入口：常态 25% 对比几乎隐形，悬浮浮出底色。专注态不显示。 */}
        {!isFocus && (
          <button
            type="button"
            className="clock-edit-btn"
            data-tauri-drag-region="false"
            title={editing ? "完成编辑" : "编辑专注时长"}
            onMouseDown={(event) => {
              // 编辑态再点铅笔 = 退出编辑。不拦 mousedown 默认聚焦的话，
              // 输入区会先 blur→exitEdit，随后的 click 看到 editing 已为
              // false 又重新 enterEdit——表现为铅笔永远退不出编辑态。
              if (editing) event.preventDefault();
            }}
            onClick={() => (editing ? exitEdit() : enterEdit())}
          >
            <Pencil size={12} />
          </button>
        )}

        <div
          ref={editBoxRef}
          className="clock-readout"
          data-tauri-drag-region="false"
          onPointerDown={handlePointerDown}
          onBlur={handleEditBlur}
        >
          {editing ? (
            <div className="clock-time clock-time-edit">
              <input
                ref={hourRef}
                className={`clock-seg ${hourNum === 0 ? "is-zero" : ""}`}
                value={hourText}
                onChange={(event) => handleHourChange(event.target.value)}
                onBlur={handleHourBlur}
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                aria-label="专注小时"
              />
              <span className="clock-sep" aria-hidden="true">
                <i />
                <i />
              </span>
              <input
                ref={minRef}
                className={`clock-seg ${minNum === 0 ? "is-zero" : ""}`}
                value={minText}
                onChange={(event) => handleMinChange(event.target.value)}
                onBlur={handleMinBlur}
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                aria-label="专注分钟"
              />
              <span className="clock-sep" aria-hidden="true">
                <i />
                <i />
              </span>
              <input
                ref={secRef}
                className={`clock-seg ${secNum === 0 ? "is-zero" : ""}`}
                value={secText}
                onChange={(event) => handleSecChange(event.target.value)}
                onBlur={handleSecBlur}
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                aria-label="专注秒"
              />
            </div>
          ) : (
            <div className="clock-time">
              <span className="clock-time-main">{timeText}</span>
              {showsSeconds && (
                <span className="clock-time-sec">{seconds}</span>
              )}
            </div>
          )}
          <div className="clock-note">
            {isFocus && <Flame size={11} className="clock-note-flame" />}
            <span>{noteText}</span>
          </div>
        </div>

        {/* 专注进度：贴着卡片底边的一根细线 */}
        {isFocus && (
          <div className="clock-progress" aria-hidden="true">
            <i
              className="clock-progress-fill"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        )}
      </div>
    </main>
  );
}
