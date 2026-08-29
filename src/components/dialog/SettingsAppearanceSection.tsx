import type { ToastKind } from "../../types/ui";
import { SettingsWidgetAppearanceSection } from "./SettingsWidgetAppearanceSection";

/**
 * 设置 → 外观分区的组合出口。当前只有「桌面便签」一张卡片；
 * 后续个性化（应用主题选择器、显示偏好等）以新卡片追加在下方——
 * 每张卡片一个独立的 Settings*Section 组件，保持本文件只做编排。
 */
export function SettingsAppearanceSection({
  onToast,
}: {
  onToast: (message: string, type: ToastKind) => void;
}) {
  return (
    <>
      <SettingsWidgetAppearanceSection onToast={onToast} />
    </>
  );
}
