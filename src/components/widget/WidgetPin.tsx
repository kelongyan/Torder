/**
 * 便签纸顶部橙色图钉：钉头贴住纸顶边、针尖触纸，纯装饰不响应交互。
 *
 * 为什么是"贴在纸内的单钉"而不是探出纸边的立体图钉：
 * Windows Release 环境可能把窗口的透明像素合成为白色，便签纸必须覆盖
 * 每一个像素，所以不能留透明外边距让钉子探出纸外。右下角的纸张感改由
 * `widget.css` 的 `.widget-shell::after` 卷角阴影承担。
 */
export function WidgetPinTop() {
  return (
    <div className="widget-pin-top" aria-hidden="true">
      <div className="pin-head" />
      <div className="pin-needle" />
    </div>
  );
}
