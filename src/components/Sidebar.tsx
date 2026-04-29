import { motion } from "framer-motion";
import type { DiagramFormat, ErdLayoutMode } from "../types";

type SidebarProps = {
  schemaText: string;
  setSchemaText: (val: string) => void;

  format: DiagramFormat;
  setFormat: (val: DiagramFormat) => void;

  erdLayout: ErdLayoutMode;
  setErdLayout: (val: ErdLayoutMode) => void;

  search: string;
  setSearch: (val: string) => void;

  activeTable: string | null;
  setActiveTable: (val: string | null) => void;

  parsedSummary: string;

  onVisualize: () => void;
  onLoadSampleSql: () => void;
  onLoadSampleErd: () => void;

  onExportImage: () => void;
  onExportPDF: () => void;
};

export default function Sidebar({
  schemaText,
  setSchemaText,
  format,
  setFormat,
  erdLayout,
  setErdLayout,
  search,
  setSearch,
  activeTable,
  setActiveTable,
  parsedSummary,
  onVisualize,
  onLoadSampleSql,
  onLoadSampleErd,
  onExportImage,
  onExportPDF,
}: SidebarProps) {
  return (
    <aside className="w-full shrink-0 border-b border-slate-800 bg-slate-900/70 p-6 backdrop-blur lg:w-[480px] lg:border-b-0 lg:border-r">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="space-y-6"
      >
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-300">
            SchemaCanvas
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-white">
            Visualize SQL or ERD in seconds
          </h1>
          <p className="text-sm text-slate-300">
            Paste SQL <span className="font-semibold">CREATE TABLE</span> or a
            Mermaid <span className="font-semibold">erDiagram</span>.
          </p>
        </div>

        <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <label
              htmlFor="schemaInput"
              className="text-sm font-medium text-slate-200"
            >
              Input
            </label>

            <div className="inline-flex overflow-hidden rounded-lg border border-slate-700">
              <button
                onClick={() => setFormat("sql")}
                className={`px-3 py-1.5 text-xs font-semibold ${
                  format === "sql"
                    ? "bg-sky-500 text-slate-950"
                    : "bg-slate-950/40 text-slate-200"
                }`}
              >
                SQL
              </button>
              <button
                onClick={() => setFormat("erd")}
                className={`px-3 py-1.5 text-xs font-semibold ${
                  format === "erd"
                    ? "bg-sky-500 text-slate-950"
                    : "bg-slate-950/40 text-slate-200"
                }`}
              >
                ERD
              </button>
            </div>
          </div>

          {format === "erd" && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-200">Layout</span>
              <div className="inline-flex overflow-hidden rounded-lg border border-slate-700">
                <button
                  onClick={() => setErdLayout("hierarchical")}
                  className={`px-3 py-1.5 text-xs font-semibold ${
                    erdLayout === "hierarchical"
                      ? "bg-slate-200 text-slate-950"
                      : "bg-slate-950/40 text-slate-200"
                  }`}
                >
                  Hierarchical
                </button>
                <button
                  onClick={() => setErdLayout("adaptive")}
                  className={`px-3 py-1.5 text-xs font-semibold ${
                    erdLayout === "adaptive"
                      ? "bg-slate-200 text-slate-950"
                      : "bg-slate-950/40 text-slate-200"
                  }`}
                >
                  Adaptive
                </button>
              </div>
            </div>
          )}

          <textarea
            id="schemaInput"
            value={schemaText}
            onChange={(e) => setSchemaText(e.target.value)}
            className="h-64 w-full resize-none rounded-lg border border-slate-700 bg-slate-950/80 p-3 font-mono text-xs leading-5 text-slate-100 outline-none transition focus:border-sky-400"
            placeholder={
              format === "erd"
                ? 'Paste Mermaid "erDiagram" here...'
                : "Paste CREATE TABLE statements..."
            }
          />

          <div className="flex flex-wrap gap-2">
            <button
              onClick={onVisualize}
              className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-400"
            >
              Visualize
            </button>
            <button
              onClick={onLoadSampleSql}
              className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-400"
            >
              Load SQL Sample
            </button>
            <button
              onClick={onLoadSampleErd}
              className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-400"
            >
              Load ERD Sample
            </button>
          </div>

          <div className="mt-2 flex flex-wrap gap-2 border-t border-slate-700/50 pt-2">
            <button
              onClick={onExportImage}
              className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-400 hover:bg-slate-800"
            >
              Export PNG
            </button>
            <button
              onClick={onExportPDF}
              className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-400 hover:bg-slate-800"
            >
              Export PDF
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-200">{parsedSummary}</p>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter tables"
            className="w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-sky-400"
          />
          {activeTable && (
            <button
              className="text-xs text-sky-300 underline-offset-2 hover:underline"
              onClick={() => setActiveTable(null)}
            >
              Clear active highlight
            </button>
          )}
        </div>
      </motion.div>
    </aside>
  );
}
