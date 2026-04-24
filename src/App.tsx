import { useMemo, useState, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";

type Column = {
  name: string;
  type: string;
  isPrimaryKey: boolean;
};

type Table = {
  name: string;
  columns: Column[];
};

type Relation = {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
};

type ParseResult = {
  tables: Table[];
  relations: Relation[];
};

type Layout = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const SAMPLE_SCHEMA = `CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  full_name VARCHAR(120) NOT NULL,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE projects (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  name VARCHAR(120) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE tasks (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  assignee_id INTEGER REFERENCES users(id),
  title VARCHAR(180) NOT NULL,
  priority INTEGER NOT NULL DEFAULT 2,
  due_date DATE,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE comments (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  author_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL
);`;

const CONSTRAINT_KEYWORDS =
  /(NOT\s+NULL|NULL|PRIMARY\s+KEY|REFERENCES|UNIQUE|DEFAULT|CHECK|CONSTRAINT)/i;

function splitDefinitions(body: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quote: "'" | '"' | null = null;

  for (const char of body) {
    if ((char === "'" || char === '"') && !quote) {
      quote = char;
      current += char;
      continue;
    }
    if (quote && char === quote) {
      quote = null;
      current += char;
      continue;
    }
    if (!quote) {
      if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth = Math.max(0, depth - 1);
      }
      if (char === "," && depth === 0) {
        const trimmed = current.trim();
        if (trimmed) {
          parts.push(trimmed);
        }
        current = "";
        continue;
      }
    }
    current += char;
  }

  const trailing = current.trim();
  if (trailing) {
    parts.push(trailing);
  }
  return parts;
}

function cleanIdentifier(value: string): string {
  return value.trim().replace(/[`"\[\]]/g, "");
}

function parseColumnsList(input: string): string[] {
  return input
    .split(",")
    .map((value) => cleanIdentifier(value))
    .filter(Boolean);
}

function parseSchema(schemaText: string): ParseResult {
  const tables: Table[] = [];
  const relations: Relation[] = [];
  const createTableRegex =
    /CREATE\s+TABLE\s+[`"\[]?(\w+)[`"\]]?\s*\(([\s\S]*?)\);/gi;

  for (const match of schemaText.matchAll(createTableRegex)) {
    const tableName = cleanIdentifier(match[1]);
    const body = match[2];
    const definitions = splitDefinitions(body);
    const columns: Column[] = [];
    const primaryColumns = new Set<string>();

    for (const definition of definitions) {
      const normalized = definition.trim();

      const primaryMatch = normalized.match(/^PRIMARY\s+KEY\s*\(([^)]+)\)/i);
      if (primaryMatch) {
        parseColumnsList(primaryMatch[1]).forEach((name) =>
          primaryColumns.add(name),
        );
        continue;
      }

      const tableFkMatch =
        normalized.match(
          /^CONSTRAINT\s+\w+\s+FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+[`"\[]?(\w+)[`"\]]?\s*\(([^)]+)\)/i,
        ) ??
        normalized.match(
          /^FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+[`"\[]?(\w+)[`"\]]?\s*\(([^)]+)\)/i,
        );

      if (tableFkMatch) {
        const fromColumn = parseColumnsList(tableFkMatch[1])[0];
        const toTable = cleanIdentifier(tableFkMatch[2]);
        const toColumn = parseColumnsList(tableFkMatch[3])[0];
        if (fromColumn && toTable && toColumn) {
          relations.push({
            fromTable: tableName,
            fromColumn,
            toTable,
            toColumn,
          });
        }
        continue;
      }

      const columnMatch = normalized.match(/^[`"\[]?(\w+)[`"\]]?\s+(.+)$/);
      if (!columnMatch) {
        continue;
      }

      const columnName = cleanIdentifier(columnMatch[1]);
      const rest = columnMatch[2];
      const type = rest.split(CONSTRAINT_KEYWORDS)[0]?.trim() || "unknown";
      const isPrimaryKey = /PRIMARY\s+KEY/i.test(rest);

      const inlineFkMatch = rest.match(
        /REFERENCES\s+[`"\[]?(\w+)[`"\]]?\s*\(([^)]+)\)/i,
      );
      if (inlineFkMatch) {
        relations.push({
          fromTable: tableName,
          fromColumn: columnName,
          toTable: cleanIdentifier(inlineFkMatch[1]),
          toColumn: parseColumnsList(inlineFkMatch[2])[0] ?? "id",
        });
      }

      columns.push({
        name: columnName,
        type,
        isPrimaryKey,
      });
    }

    tables.push({
      name: tableName,
      columns: columns.map((column) => ({
        ...column,
        isPrimaryKey: column.isPrimaryKey || primaryColumns.has(column.name),
      })),
    });
  }

  return { tables, relations };
}

function buildLayout(tables: Table[]): Record<string, Layout> {
  const width = 290;
  const headerHeight = 44;
  const rowHeight = 30;
  const horizontalGap = 56;
  const verticalGap = 46;
  const colCount = Math.max(1, Math.ceil(Math.sqrt(tables.length)));
  const layout: Record<string, Layout> = {};

  tables.forEach((table, index) => {
    const col = index % colCount;
    const row = Math.floor(index / colCount);
    const height = headerHeight + Math.max(1, table.columns.length) * rowHeight;

    layout[table.name] = {
      x: col * (width + horizontalGap) + 32,
      y: row * (250 + verticalGap) + 32,
      width,
      height,
    };
  });

  return layout;
}

function getColumnY(table: Table, layout: Layout, columnName: string): number {
  const index = table.columns.findIndex((column) => column.name === columnName);
  const safeIndex = index >= 0 ? index : 0;
  return layout.y + 44 + safeIndex * 30 + 15;
}

function RelationLayer({
  tables,
  layout,
  relations,
  activeTable,
}: {
  tables: Table[];
  layout: Record<string, Layout>;
  relations: Relation[];
  activeTable: string | null;
}) {
  const tableMap = useMemo(
    () => new Map(tables.map((table) => [table.name, table])),
    [tables],
  );

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
      <defs>
        <marker
          id="arrow"
          markerWidth="10"
          markerHeight="8"
          refX="9"
          refY="4"
          orient="auto"
        >
          <path d="M0,0 L10,4 L0,8 Z" fill="#60a5fa" />
        </marker>
      </defs>
      {relations.map((relation, index) => {
        const fromTable = tableMap.get(relation.fromTable);
        const toTable = tableMap.get(relation.toTable);
        const fromLayout = layout[relation.fromTable];
        const toLayout = layout[relation.toTable];

        if (!fromTable || !toTable || !fromLayout || !toLayout) {
          return null;
        }

        const fromRight = fromLayout.x + fromLayout.width;
        const fromLeft = fromLayout.x;
        const toLeft = toLayout.x;
        const toRight = toLayout.x + toLayout.width;
        const sourceY = getColumnY(fromTable, fromLayout, relation.fromColumn);
        const targetY = getColumnY(toTable, toLayout, relation.toColumn);
        const useRightSide = fromLayout.x <= toLayout.x;
        const startX = useRightSide ? fromRight : fromLeft;
        const endX = useRightSide ? toLeft : toRight;
        const controlOffset = Math.max(60, Math.abs(endX - startX) * 0.35);

        const path = `M ${startX} ${sourceY} C ${startX + (useRightSide ? controlOffset : -controlOffset)} ${sourceY}, ${endX + (useRightSide ? -controlOffset : controlOffset)} ${targetY}, ${endX} ${targetY}`;
        const isActive =
          !activeTable ||
          relation.fromTable === activeTable ||
          relation.toTable === activeTable;

        return (
          <motion.path
            key={`${relation.fromTable}-${relation.fromColumn}-${relation.toTable}-${relation.toColumn}-${index}`}
            d={path}
            fill="none"
            stroke={isActive ? "#60a5fa" : "#64748b"}
            strokeWidth={isActive ? 2.4 : 1.4}
            opacity={isActive ? 0.95 : 0.3}
            markerEnd="url(#arrow)"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: isActive ? 0.95 : 0.3 }}
            transition={{ duration: 0.7, delay: index * 0.03 }}
          />
        );
      })}
    </svg>
  );
}

export default function App() {
  const [schemaText, setSchemaText] = useState(SAMPLE_SCHEMA);
  const [search, setSearch] = useState("");
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResult>(() =>
    parseSchema(SAMPLE_SCHEMA),
  );

  const canvasRef = useRef<HTMLDivElement>(null);

  const exportAsImage = async () => {
    if (!canvasRef.current) return;
    try {
      const dataUrl = await toPng(canvasRef.current, {
        cacheBust: true,
        backgroundColor: "#020617",
      });
      const link = document.createElement("a");
      link.download = "database-schema.png";
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error("Failed to export image", err);
    }
  };

  const exportAsPDF = async () => {
    if (!canvasRef.current) return;
    try {
      const dataUrl = await toPng(canvasRef.current, {
        cacheBust: true,
        backgroundColor: "#020617",
      });
      const imgProps = new jsPDF().getImageProperties(dataUrl);
      const pdf = new jsPDF("p", "mm", "a4");

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

      pdf.addImage(dataUrl, "PNG", 0, 0, pdfWidth, pdfHeight);
      pdf.save("database-schema.pdf");
    } catch (err) {
      console.error("Failed to export PDF", err);
    }
  };

  const filteredTables = useMemo(() => {
    if (!search.trim()) {
      return result.tables;
    }
    const term = search.toLowerCase();
    return result.tables.filter((table) =>
      table.name.toLowerCase().includes(term),
    );
  }, [result.tables, search]);

  const layout = useMemo(() => buildLayout(filteredTables), [filteredTables]);

  const canvasSize = useMemo(() => {
    const values = Object.values(layout);
    const width = values.length
      ? Math.max(...values.map((item) => item.x + item.width)) + 72
      : 720;
    const height = values.length
      ? Math.max(...values.map((item) => item.y + item.height)) + 72
      : 500;
    return { width, height };
  }, [layout]);

  const parsedSummary = `${result.tables.length} tables • ${result.relations.length} relations`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col lg:flex-row">
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
                Paste SQL CREATE TABLE statements, then inspect table structures
                and foreign key links.
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
                onChange={(event) => setSchemaText(event.target.value)}
                className="h-64 w-full resize-none rounded-lg border border-slate-700 bg-slate-950/80 p-3 font-mono text-xs leading-5 text-slate-100 outline-none transition focus:border-sky-400"
                placeholder="Paste CREATE TABLE statements..."
              />
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    const parsed = parseSchema(schemaText);
                    setResult(parsed);
                    setActiveTable(null);
                  }}
                  className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-400"
                >
                  Visualize Schema
                </button>
                <button
                  onClick={() => {
                    setSchemaText(SAMPLE_SCHEMA);
                    setResult(parseSchema(SAMPLE_SCHEMA));
                    setSearch("");
                    setActiveTable(null);
                  }}
                  className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-400"
                >
                  Load Sample
                </button>
              </div>

              <div className="flex flex-wrap gap-2 pt-2 mt-2 border-t border-slate-700/50">
                <button
                  onClick={exportAsImage}
                  className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-400 hover:bg-slate-800"
                >
                  Export PNG
                </button>
                <button
                  onClick={exportAsPDF}
                  className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-400 hover:bg-slate-800"
                >
                  Export PDF
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-200">
                {parsedSummary}
              </p>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
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

        <main className="relative flex-1 overflow-auto bg-[radial-gradient(circle_at_top_left,_#1e293b_0%,_#0f172a_45%,_#020617_100%)] p-5 lg:p-8">
          <div
            ref={canvasRef}
            className="relative"
            style={{
              width: `${canvasSize.width}px`,
              minHeight: `${canvasSize.height}px`,
            }}
          >
            <RelationLayer
              tables={filteredTables}
              layout={layout}
              relations={result.relations.filter(
                (relation) =>
                  layout[relation.fromTable] && layout[relation.toTable],
              )}
              activeTable={activeTable}
            />

            <AnimatePresence>
              {filteredTables.map((table, index) => {
                const box = layout[table.name];
                if (!box) {
                  return null;
                }
                const isActive = !activeTable || activeTable === table.name;

                return (
                  <motion.section
                    key={table.name}
                    initial={{ opacity: 0, y: 14, scale: 0.98 }}
                    animate={{ opacity: isActive ? 1 : 0.45, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.25, delay: index * 0.03 }}
                    className="absolute overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900/90 shadow-xl shadow-black/40"
                    style={{
                      left: box.x,
                      top: box.y,
                      width: box.width,
                      minHeight: box.height,
                    }}
                  >
                    <button
                      onClick={() =>
                        setActiveTable((current) =>
                          current === table.name ? null : table.name,
                        )
                      }
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
              })}
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}
