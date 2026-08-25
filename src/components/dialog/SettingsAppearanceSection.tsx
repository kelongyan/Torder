import { Palette } from "lucide-react";

export function SettingsAppearanceSection() {
  return (
    <section className="settings-section">
      <h3 className="settings-section-title">
        <Palette aria-hidden="true" className="icon-sm" />
        外观设置
      </h3>
      <p className="settings-section-hint">这里会继续补充显示相关设置。</p>
    </section>
  );
}
