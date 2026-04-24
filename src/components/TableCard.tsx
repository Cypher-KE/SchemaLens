import { motion } from "framer-motion";
import { Table, Layout } from "../types";

type TableCardProps = {
  table: Table;
  layoutBox: Layout;
  isActive: boolean;
  index: number;
  onToggleActive: () => void;
};

export default function TableCard({
  table,
  layoutBox,
  isActive,
  index,
  onToggleActive,
}: TableCardProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: isActive ? 1 : 0.45, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.25, delay: index * 0.03 }}
      className="absolute overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900/90 shadow-xl shadow-black/40"
      style={{
        left: layoutBox.x,
        top: layoutBox.y,
        width: layoutBox.width,
        minHeight: layoutBox.height,
      }}
    >
      <button
        onClick={onToggleActive}
        className="flex w-full items-center justify-between border-b border-slate-700 bg-slate-800/90 px-4 py-3 text-left"
      >
        <span className="font-semibold tracking-tight text-white">
          {table.name}
        </span>
        <span className="text-xs text-sky-300">
          {table.columns.length} cols
        </span>
      </button>
      <ul className="divide-y divide-slate-800">
        {table.columns.map((column) => (
          <li
            key={column.name}
            className="flex items-center justify-between px-4 py-2 text-sm"
          >
            <span className="flex items-center gap-2 font-medium text-slate-100">
              {column.isPrimaryKey && (
                <span className="inline-flex rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-300">
                  PK
                </span>
              )}
              {column.name}
            </span>
            <span className="text-xs uppercase tracking-wide text-slate-400">
              {column.type}
            </span>
          </li>
        ))}
      </ul>
    </motion.section>
  );
}
