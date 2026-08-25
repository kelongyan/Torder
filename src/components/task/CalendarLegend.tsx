import { CircleDot, Plane, Sun } from "lucide-react";

export function CalendarLegend() {
  return (
    <footer className="month-legend">
      <span className="month-legend-item">
        <Sun aria-hidden="true" className="month-legend-icon leave" />
        休假
      </span>
      <span className="month-legend-item">
        <Plane aria-hidden="true" className="month-legend-icon trip" />
        出差
      </span>
      <span className="month-legend-item">
        <CircleDot aria-hidden="true" className="month-legend-icon other" />
        其他
      </span>
    </footer>
  );
}
