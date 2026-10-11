import { ChevronDown, ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "../../lib/utils";

export function CollapsibleSection({
  title,
  badge,
  hint,
  defaultOpen = false,
  className,
  children,
}: {
  title: string;
  badge?: string;
  hint?: string;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={cn("workflow-panel collapsible-panel", open && "open", className)}>
      <button type="button" className="collapsible-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <h2>{title}</h2>
        {badge ? <span className="collapsible-badge">{badge}</span> : null}
        {hint ? <span className="collapsible-hint">{hint}</span> : null}
      </button>
      {open ? children : null}
    </section>
  );
}
