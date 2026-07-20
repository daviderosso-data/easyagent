"use client";

import { useAgent } from "@/store/agent";
import { SessionPanel } from "@/components/SessionPanel";

export function PanelsGrid({ onChangeFolder }: { onChangeFolder: (id: string) => void }) {
  const panels = useAgent((s) => s.panels);
  // 1-4 panels: fixed layouts filling the viewport. 5+: two columns with a
  // minimum row height and vertical scrolling, so panels stay readable.
  const layout = panels.length <= 4 ? `panels-${panels.length}` : "panels-many";
  return (
    <div className={`panels-grid ${layout}`}>
      {panels.map((id) => (
        <SessionPanel key={id} id={id} onChangeFolder={onChangeFolder} />
      ))}
    </div>
  );
}
