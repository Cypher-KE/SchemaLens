import { motion } from "framer-motion";
import type { DiagramFormat, Table, Layout } from "../types";
import { TABLE_HEADER_HEIGHT, TABLE_ROW_HEIGHT } from "../utils/schemaParser";

type TableCardProps = {
  table: Table;
  layoutBox: Layout;
  isActive: boolean;
  index: number;
  mode: DiagramFormat;
  onToggleActive: () => void;
};

function hashHue(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 360;
}

export default function TableCard({
  table,
  layoutBox,
  isActive,
  index,
  mode,
  onToggleActive,
}: TableCardProps) {
  const hue = hashHue(table.name);
  const border = `hsl(${hue} 85% 60% / 0.85)`;
  const headerBg = `hsl(${hue} 70% 55% / 0.14)`;
  const headerLine = `hsl(${hue} 85% 60% / 0.45)`;

  return (
    <motion.section
      initial={{ opacity: 0, y: 14, scale: 0.985 }}
      animate={{ opacity: isActive ? 1 : 0.45, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.25, delay: index * 0.03 }}
      className="absolute overflow-hidden rounded-xl border shadow-xl"
      style={{
        left: layoutBox.x,
        top: layoutBox.y,
        width: layoutBox.width,
        minHeight: layoutBox.height,
        borderColor: border,
        backgroundColor: "hsl(var(--card) / 0.92)",
        boxShadow: "0 18px 50px rgba(0,0,0,0.25)",
      }}
    >
      <button
        onClick={onToggleActive}
        className="flex w-full items-center justify-between border-b px-4 text-left"
        style={{
          height: TABLE_HEADER_HEIGHT,
          borderColor: headerLine,
          background: headerBg,
        }}
      >
        <span
          className="font-semibold tracking-tight"
          style={{ color: "hsl(var(--card-fg))" }}
        >
          {table.name}
        </span>
        <span className="text-xs" style={{ color: border }}>
          {table.columns.length} cols
        </span>
      </button>

      {mode === "erd" ? (
        <ul>
          {table.columns.map((c) => {
            const key = c.isPrimaryKey ? "PK" : c.isForeignKey ? "FK" : "";
            return (
              <li
                key={c.name}
                className="grid items-center px-4 text-xs"
                style={{
                  height: TABLE_ROW_HEIGHT,
                  color: "hsl(var(--card-fg))",
                  boxShadow: "inset 0 -1px 0 hsl(var(--border) / 0.35)",
                  gridTemplateColumns: "88px 1fr 44px 1fr",
                  gap: 10,
                }}
              >
                <span
                  className="uppercase tracking-wide"
                  style={{ color: "hsl(var(--muted-fg))" }}
                >
                  {c.type}
                </span>

                <span className="truncate font-medium">{c.name}</span>

                <span className="text-[11px] font-semibold">
                  {key ? (
                    <span
                      className="inline-flex rounded px-1.5 py-0.5"
                      style={{
                        background: c.isPrimaryKey
                          ? "hsl(var(--warning) / 0.16)"
                          : "hsl(var(--accent) / 0.14)",
                        color: c.isPrimaryKey
                          ? "hsl(var(--warning))"
                          : "hsl(var(--accent))",
                      }}
                    >
                      {key}
                    </span>
                  ) : (
                    <span className="opacity-30">—</span>
                  )}
                </span>

                <span
                  className="truncate"
                  style={{ color: "hsl(var(--muted-fg))" }}
                  title={c.note}
                >
                  {c.note ?? ""}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul>
          {table.columns.map((column) => (
            <li
              key={column.name}
              className="flex items-center justify-between px-4 text-sm"
              style={{
                height: TABLE_ROW_HEIGHT,
                color: "hsl(var(--card-fg))",
                boxShadow: "inset 0 -1px 0 hsl(var(--border) / 0.35)",
              }}
            >
              <span className="flex items-center gap-2 font-medium">
                {column.isPrimaryKey && (
                  <span
                    className="inline-flex rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase"
                    style={{
                      background: "hsl(var(--warning) / 0.16)",
                      color: "hsl(var(--warning))",
                    }}
                  >
                    PK
                  </span>
                )}
                {column.isForeignKey && (
                  <span
                    className="inline-flex rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase"
                    style={{
                      background: "hsl(var(--accent) / 0.14)",
                      color: "hsl(var(--accent))",
                    }}
                  >
                    FK
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
      )}
    </motion.section>
  );
}
