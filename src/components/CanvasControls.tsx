type CanvasControlsProps = {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
};

function btnStyle(bg: string, fg: string) {
  return {
    background: bg,
    color: fg,
    borderColor: "hsl(var(--border) / 0.7)",
    boxShadow: "0 16px 40px rgba(0,0,0,0.28)",
  } as const;
}

export default function CanvasControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
}: CanvasControlsProps) {
  return (
    <div
      className="pointer-events-auto absolute bottom-4 right-4 z-10 flex flex-col items-end gap-2"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onWheel={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <div
        className="rounded-full border px-2.5 py-1 text-xs font-semibold tracking-wide"
        style={{
          background: "hsl(var(--card) / 0.6)",
          borderColor: "hsl(var(--border) / 0.7)",
          color: "hsl(var(--muted-fg))",
          backdropFilter: "blur(10px)",
        }}
        title="Wheel to zoom • drag to pan • double-click to reset"
      >
        {Math.round(zoom * 100)}%
      </div>

      <button
        onClick={onZoomIn}
        className="grid h-11 w-11 place-items-center rounded-2xl border text-sm font-semibold"
        style={btnStyle("hsl(var(--accent) / 0.95)", "hsl(var(--bg))")}
        aria-label="Zoom in"
        title="Zoom in"
      >
        +
      </button>

      <button
        onClick={onZoomOut}
        className="grid h-11 w-11 place-items-center rounded-2xl border text-sm font-semibold"
        style={btnStyle("hsl(var(--accent-2) / 0.92)", "hsl(var(--bg))")}
        aria-label="Zoom out"
        title="Zoom out"
      >
        −
      </button>

      <button
        onClick={onReset}
        className="rounded-2xl border px-3 py-2 text-xs font-semibold"
        style={btnStyle("hsl(var(--card) / 0.7)", "hsl(var(--fg))")}
        aria-label="Reset view"
        title="Reset view"
      >
        Reset
      </button>
    </div>
  );
}
