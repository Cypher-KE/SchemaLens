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

export function parseSchema(schemaText: string): ParseResult {
  const tables: Table[] = [];
  const relations: Relation[] = [];
  const createTableRegex =
    /CREATE\s+TABLE\s+[`"\[]?(\w+)[`"\]]?\s*\(([\s\S]*?)\);/gi;

  for (const match of schemaText.matchAll(createTableRegex)) {
    const tableName = cleanIdentifier(match[1]);
    const body = match[2];
    const definitions = splitDefinitions(body);
    const columns: [] = [];
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
      } as never);
    }

    tables.push({
      name: tableName,
      columns: columns.map((column: any) => ({
        ...column,
        isPrimaryKey: column.isPrimaryKey || primaryColumns.has(column.name),
      })),
    });
  }

  return { tables, relations };
}

export function buildLayout(tables: Table[]): Record<string, Layout> {
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

export function getColumnY(
  table: Table,
  layout: Layout,
  columnName: string,
): number {
  const index = table.columns.findIndex((column) => column.name === columnName);
  const safeIndex = index >= 0 ? index : 0;
  return layout.y + 44 + safeIndex * 30 + 15;
}
