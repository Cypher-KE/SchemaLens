import { Table, Relation, ParseResult, Layout } from "../types";

export const SAMPLE_SCHEMA = `CREATE TABLE users (
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
      if (char === "(") depth += 1;
      else if (char === ")") depth = Math.max(0, depth - 1);

      if (char === "," && depth === 0) {
        const trimmed = current.trim();
        if (trimmed) parts.push(trimmed);
        current = "";
        continue;
      }
    }
    current += char;
  }

  const trailing = current.trim();
  if (trailing) parts.push(trailing);
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

export function parseSchema(schemaText: string): ParseResult {
  const tables: Table[] = [];
  const relations: Relation[] = [];
  const createTableRegex =
    /CREATE\s+TABLE\s+[`"\[]?(\w+)[`"\]]?\s*\(([\s\S]*?)\);/gi;

  for (const match of schemaText.matchAll(createTableRegex)) {
    const tableName = cleanIdentifier(match[1]);
    const body = match[2];
    const definitions = splitDefinitions(body);

    const columns: Array<{
      name: string;
      type: string;
      isPrimaryKey: boolean;
    }> = [];
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
      if (!columnMatch) continue;

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

      columns.push({ name: columnName, type, isPrimaryKey });
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

/* ------------------ sizing constants ------------------ */

export const TABLE_WIDTH = 290;
export const TABLE_HEADER_HEIGHT = 44;
export const TABLE_ROW_HEIGHT = 30;

export const LAYOUT_PADDING = 32;
export const LAYOUT_GAP_X = 72;
export const LAYOUT_GAP_Y = 56;

function getTableHeight(table: Table) {
  return (
    TABLE_HEADER_HEIGHT + Math.max(1, table.columns.length) * TABLE_ROW_HEIGHT
  );
}

function orderTablesForLayout(tables: Table[], relations?: Relation[]) {
  if (!relations?.length) return tables;

  const names = new Set(tables.map((t) => t.name));
  const children = new Map<string, Set<string>>();
  const indeg = new Map<string, number>();

  for (const t of tables) {
    children.set(t.name, new Set());
    indeg.set(t.name, 0);
  }

  // referenced (toTable) -> referencing (fromTable)
  for (const r of relations) {
    if (!names.has(r.fromTable) || !names.has(r.toTable)) continue;
    if (r.fromTable === r.toTable) continue;

    const set = children.get(r.toTable)!;
    if (!set.has(r.fromTable)) {
      set.add(r.fromTable);
      indeg.set(r.fromTable, (indeg.get(r.fromTable) ?? 0) + 1);
    }
  }

  // topo-ish order (cycles handled)
  const q: string[] = [];
  for (const t of tables) if ((indeg.get(t.name) ?? 0) === 0) q.push(t.name);

  const topo: string[] = [];
  const indegWork = new Map(indeg);

  while (q.length) {
    const n = q.shift()!;
    topo.push(n);
    for (const c of children.get(n) ?? []) {
      indegWork.set(c, (indegWork.get(c) ?? 0) - 1);
      if ((indegWork.get(c) ?? 0) === 0) q.push(c);
    }
  }

  for (const t of tables) if (!topo.includes(t.name)) topo.push(t.name);

  // depth (layer) used only for sorting, not for forcing vertical stacking
  const depth = new Map<string, number>();
  for (const n of topo) depth.set(n, 0);
  for (const n of topo) {
    const d = depth.get(n) ?? 0;
    for (const c of children.get(n) ?? []) {
      depth.set(c, Math.max(depth.get(c) ?? 0, d + 1));
    }
  }

  const degree = new Map<string, number>();
  for (const t of tables) {
    degree.set(
      t.name,
      (children.get(t.name)?.size ?? 0) + (indeg.get(t.name) ?? 0),
    );
  }

  const tableByName = new Map(tables.map((t) => [t.name, t]));
  return topo
    .slice()
    .sort((a, b) => {
      const da = depth.get(a) ?? 0;
      const db = depth.get(b) ?? 0;
      if (da !== db) return da - db;
      const ga = degree.get(a) ?? 0;
      const gb = degree.get(b) ?? 0;
      if (ga !== gb) return gb - ga;
      return a.localeCompare(b);
    })
    .map((name) => tableByName.get(name)!)
    .filter(Boolean);
}

/**
 * Responsive grid layout + smarter ordering (does NOT collapse into one column).
 */
export function buildLayout(
  tables: Table[],
  options?: { availableWidth?: number; relations?: Relation[] },
): Record<string, Layout> {
  const availableWidth = Math.max(420, options?.availableWidth ?? 1200);

  const ordered = orderTablesForLayout(tables, options?.relations);

  const colCount = Math.max(
    1,
    Math.min(
      ordered.length,
      Math.floor(
        (availableWidth - LAYOUT_PADDING * 2 + LAYOUT_GAP_X) /
          (TABLE_WIDTH + LAYOUT_GAP_X),
      ),
    ),
  );

  const heights = ordered.map(getTableHeight);
  const rowCount = Math.max(1, Math.ceil(ordered.length / colCount));

  const rowHeights = Array.from({ length: rowCount }, () => 0);
  for (let i = 0; i < ordered.length; i++) {
    const row = Math.floor(i / colCount);
    rowHeights[row] = Math.max(rowHeights[row], heights[i]);
  }

  const rowOffsets: number[] = [];
  let y = LAYOUT_PADDING;
  for (let r = 0; r < rowCount; r++) {
    rowOffsets[r] = y;
    y += rowHeights[r] + LAYOUT_GAP_Y;
  }

  const layout: Record<string, Layout> = {};
  ordered.forEach((table, index) => {
    const col = index % colCount;
    const row = Math.floor(index / colCount);

    layout[table.name] = {
      x: LAYOUT_PADDING + col * (TABLE_WIDTH + LAYOUT_GAP_X),
      y: rowOffsets[row],
      width: TABLE_WIDTH,
      height: heights[index],
    };
  });

  return layout;
}

export function getColumnY(
  table: Table,
  layout: Layout,
  columnName: string,
): number {
  const index = table.columns.findIndex((c) => c.name === columnName);
  const safeIndex = index >= 0 ? index : 0;

  return (
    layout.y +
    TABLE_HEADER_HEIGHT +
    safeIndex * TABLE_ROW_HEIGHT +
    TABLE_ROW_HEIGHT / 2
  );
}
