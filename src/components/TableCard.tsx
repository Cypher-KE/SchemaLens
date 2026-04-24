import { motion } from "framer-motion";
import { Table, Layout } from "../types";
import { TABLE_HEADER_HEIGHT, TABLE_ROW_HEIGHT } from "../utils/schemaParser";

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
      className="absolute overflow-hidden rounded-xl border shadow-xl"
      style={{
        left: layoutBox.x,
        top: layoutBox.y,
        width: layoutBox.width,
        minHeight: layoutBox.height,
        borderColor: "hsl(var(--border) / 0.75)",
        backgroundColor: "hsl(var(--card) / 0.92)",
        boxShadow: "0 18px 50px rgba(0,0,0,0.25)",
      }}
    >
      <button
        onClick={onToggleActive}
        className="flex w-full items-center justify-between border-b px-4 text-left"
        style={{
          height: TABLE_HEADER_HEIGHT,
          borderColor: "hsl(var(--border) / 0.65)",
          background: "hsl(var(--muted) / 0.75)",
        }}
      >
        <span
          className="font-semibold tracking-tight"
          style={{ color: "hsl(var(--card-fg))" }}
        >
          {table.name}
        </span>
        <span className="text-xs" style={{ color: "hsl(var(--accent))" }}>
          {table.columns.length} cols
        </span>
      </button>

      <ul>
        {table.columns.map((column) => (
          <li
            key={column.name}
            className="flex items-center justify-between px-4 text-sm"
            style={{
              height: TABLE_ROW_HEIGHT,
              color: "hsl(var(--card-fg))",
              /* separator without changing layout height */
              boxShadow: "inset 0 -1px 0 hsl(var(--border) / 0.35)",
            }}
          >
            <span className="flex items-center gap-2 font-medium">
              {column.isPrimaryKey && (
                <span
                  className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                  style={{
                    background: "hsl(var(--warning) / 0.16)",
                    color: "hsl(var(--warning))",
                  }}
                >
                  PK
                </span>
              )}
              {column.name}
            </span>

            <span
              className="text-xs uppercase tracking-wide"
              style={{ color: "hsl(var(--muted-fg))" }}
            >
              {column.type}
            </span>
          </li>
        ))}
      </ul>
    </motion.section>
  );
}
