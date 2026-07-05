"use client";

import { useAgent } from "@/store/agent";
import { SessionPanel } from "@/components/SessionPanel";

export function PanelsGrid({ onChangeFolder }: { onChangeFolder: (id: string) => void }) {
  const panels = useAgent((s) => s.panels);
  return (
    <div className={`panels-grid panels-${panels.length}`}>
      {panels.map((id) => (
        <SessionPanel key={id} id={id} onChangeFolder={onChangeFolder} />
      ))}
    </div>
  );
}
