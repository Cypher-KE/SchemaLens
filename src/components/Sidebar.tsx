import { motion } from "framer-motion";
import type { DiagramFormat, LayoutDirection } from "../types";

type SidebarProps = {
  schemaText: string;
  setSchemaText: (val: string) => void;

  format: DiagramFormat;
  setFormat: (val: DiagramFormat) => void;

  direction: LayoutDirection;
  setDirection: (val: LayoutDirection) => void;

  search: string;
  setSearch: (val: string) => void;

  activeTable: string | null;
  setActiveTable: (val: string | null) => void;

  parsedSummary: string;

  onVisualize: () => void;
  onLoadSample: () => void;

  onExportImage: () => void;
  onExportPDF: () => void;
};

export default function Sidebar({
  schemaText,
  setSchemaText,
  format,
  setFormat,
  direction,
  setDirection,
  search,
  setSearch,
  activeTable,
  setActiveTable,
  parsedSummary,
  onVisualize,
  onLoadSample,
  onExportImage,
  onExportPDF,
}: SidebarProps) {
  const panelBg = "hsl(var(--card) / 0.55)";
  const panelBorder = "hsl(var(--border) / 0.7)";
  const muted = "hsl(var(--muted-fg))";
  const accent = "hsl(var(--accent))";
  const accent2 = "hsl(var(--accent-2))";

  return (
    <aside
      className="w-full shrink-0 border-b p-6 backdrop-blur lg:w-[480px] lg:border-b-0 lg:border-r"
      style={{ background: panelBg, borderColor: panelBorder }}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="space-y-6"
      >
        <div className="space-y-2">
          <p
            className="text-xs font-semibold uppercase tracking-[0.2em]"
            style={{ color: accent2 }}
          >
            SchemaCanvas
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Visualize SQL or ERD in seconds
          </h1>
          <p className="text-sm" style={{ color: muted }}>
            Paste SQL <span className="font-semibold">CREATE TABLE</span> or a
            Mermaid <span className="font-semibold">erDiagram</span>.
          </p>
        </div>

        <div
          className="space-y-3 rounded-xl border p-4"
          style={{
            borderColor: panelBorder,
            background: "hsl(var(--bg) / 0.25)",
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <label
              htmlFor="schemaInput"
              className="text-sm font-medium"
              style={{ color: "hsl(var(--fg))" }}
            >
              Input
            </label>

            <div
              className="inline-flex overflow-hidden rounded-lg border"
              style={{ borderColor: panelBorder }}
            >
              <button
                onClick={() => setFormat("sql")}
                className="px-3 py-1.5 text-xs font-semibold"
                style={{
                  background:
                    format === "sql" ? accent : "hsl(var(--bg) / 0.35)",
                  color: format === "sql" ? "hsl(var(--bg))" : "hsl(var(--fg))",
                }}
              >
                SQL
              </button>
              <button
                onClick={() => setFormat("erd")}
                className="px-3 py-1.5 text-xs font-semibold"
                style={{
                  background:
                    format === "erd" ? accent : "hsl(var(--bg) / 0.35)",
                  color: format === "erd" ? "hsl(var(--bg))" : "hsl(var(--fg))",
                }}
              >
                ERD
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span
              className="text-sm font-medium"
              style={{ color: "hsl(var(--fg))" }}
            >
              Direction
            </span>

            <div
              className="inline-flex overflow-hidden rounded-lg border"
              style={{ borderColor: panelBorder }}
            >
              <button
                onClick={() => setDirection("horizontal")}
                className="px-3 py-1.5 text-xs font-semibold"
                style={{
                  background:
                    direction === "horizontal"
                      ? "hsl(var(--fg) / 0.9)"
                      : "hsl(var(--bg) / 0.35)",
                  color:
                    direction === "horizontal"
                      ? "hsl(var(--bg))"
                      : "hsl(var(--fg))",
                }}
              >
                Horizontal
              </button>
              <button
                onClick={() => setDirection("vertical")}
                className="px-3 py-1.5 text-xs font-semibold"
                style={{
                  background:
                    direction === "vertical"
                      ? "hsl(var(--fg) / 0.9)"
                      : "hsl(var(--bg) / 0.35)",
                  color:
                    direction === "vertical"
                      ? "hsl(var(--bg))"
                      : "hsl(var(--fg))",
                }}
              >
                Vertical
              </button>
            </div>
          </div>

          <textarea
            id="schemaInput"
            value={schemaText}
            onChange={(e) => setSchemaText(e.target.value)}
            className="h-124 w-full resize-none rounded-lg border p-3 font-sans text-lg leading-5 outline-none transition"
            style={{
              borderColor: panelBorder,
              background: "hsl(var(--bg) / 0.55)",
              color: "hsl(var(--fg))",
            }}
            placeholder={
              format === "erd"
                ? 'Paste Mermaid "erDiagram" here...'
                : "Paste CREATE TABLE statements..."
            }
          />

          <div className="flex flex-wrap gap-2">
            <button
              onClick={onVisualize}
              className="rounded-lg px-4 py-2 text-sm font-semibold transition"
              style={{ background: accent, color: "hsl(var(--bg))" }}
            >
              Visualize
            </button>

            <button
              onClick={onLoadSample}
              className="rounded-lg border px-4 py-2 text-sm font-semibold transition"
              style={{
                borderColor: panelBorder,
                color: "hsl(var(--fg))",
                background: "hsl(var(--bg) / 0.15)",
              }}
            >
              Load Sample
            </button>
          </div>

          <div
            className="mt-2 flex flex-wrap gap-2 border-t pt-2"
            style={{ borderColor: "hsl(var(--border) / 0.45)" }}
          >
            <button
              onClick={onExportImage}
              className="rounded-lg border px-4 py-2 text-sm font-semibold transition"
              style={{
                borderColor: panelBorder,
                color: "hsl(var(--fg))",
                background: "hsl(var(--bg) / 0.15)",
              }}
            >
              Export PNG
            </button>
            <button
              onClick={onExportPDF}
              className="rounded-lg border px-4 py-2 text-sm font-semibold transition"
              style={{
                borderColor: panelBorder,
                color: "hsl(var(--fg))",
                background: "hsl(var(--bg) / 0.15)",
              }}
            >
              Export PDF
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium" style={{ color: muted }}>
            {parsedSummary}
          </p>

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter tables"
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition"
            style={{
              borderColor: panelBorder,
              background: "hsl(var(--bg) / 0.55)",
              color: "hsl(var(--fg))",
            }}
          />

          {activeTable && (
            <button
              className="text-xs underline-offset-2 hover:underline"
              style={{ color: accent2 }}
              onClick={() => setActiveTable(null)}
            >
              Clear active highlight
            </button>
          )}
        </div>

        <div className="text-xs" style={{ color: muted }}>
          Tip: wheel to zoom at cursor • Space + drag to pan • double-click to
          reset
        </div>
      </motion.div>
    </aside>
  );
}
