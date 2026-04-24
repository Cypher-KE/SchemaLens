import { motion } from "framer-motion";

type SidebarProps = {
  schemaText: string;
  setSchemaText: (val: string) => void;
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
  return (
    <aside className="w-full shrink-0 border-b border-slate-800 bg-slate-900/70 p-6 backdrop-blur lg:w-[380px] lg:border-b-0 lg:border-r">
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
            Visualize your database in seconds
          </h1>
          <p className="text-sm text-slate-300">
            Paste SQL CREATE TABLE statements, then inspect table structures and
            foreign key links.
          </p>
        </div>

        <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
          <label
            htmlFor="schemaInput"
            className="text-sm font-medium text-slate-200"
          >
            SQL Schema
          </label>
          <textarea
            id="schemaInput"
            value={schemaText}
            onChange={(e) => setSchemaText(e.target.value)}
            className="h-64 w-full resize-none rounded-lg border border-slate-700 bg-slate-950/80 p-3 font-mono text-xs leading-5 text-slate-100 outline-none transition focus:border-sky-400"
            placeholder="Paste CREATE TABLE statements..."
          />
          <div className="flex flex-wrap gap-2">
            <button
              onClick={onVisualize}
              className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-400"
            >
              Visualize Schema
            </button>
            <button
              onClick={onLoadSample}
              className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-400"
            >
              Load Sample
            </button>
          </div>

          <div className="flex flex-wrap gap-2 pt-2 mt-2 border-t border-slate-700/50">
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
