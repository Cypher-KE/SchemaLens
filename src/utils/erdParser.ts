import type {
  Cardinality,
  Column,
  ParseResult,
  Relation,
  Table,
} from "../types";

export const SAMPLE_ERD = `erDiagram
    users {
        bigint id PK
        string name
        string email
        enum type "player or operator"
        string password
        created_at datetime
        updated_at datetime
    }

    bonus_requests {
        bigint id PK
        bigint user_id FK
        string bonus_code
        enum status "pending | approved | rejected"
        created_at datetime
        updated_at datetime
    }

    call_requests {
        bigint id PK
        bigint user_id FK
        string reason
        datetime preferred_time
        enum status "pending | approved | rejected"
        created_at datetime
        updated_at datetime
    }

    support_requests {
        bigint id PK
        bigint user_id FK
        text message
        enum priority "low | normal | high"
        enum status "pending | in_progress | resolved | rejected"
        created_at datetime
        updated_at datetime
    }

    document_submissions {
        bigint id PK
        bigint user_id FK
        enum document_type
        string document_number
        string document_path
        enum status "pending | approved | rejected"
        created_at datetime
        updated_at datetime
    }

    operators {
        bigint id PK
        bigint user_id FK
        string position
        bigint operator_group_id FK
        created_at datetime
        updated_at datetime
    }

    operator_groups {
        bigint id PK
        string name
        text description
        created_at datetime
        updated_at datetime
    }

    operator_change_timelines {
        bigint id PK
        bigint operator_id FK
        bigint changed_by_user_id FK
        string change_type
        text change_description
        created_at datetime
        updated_at datetime
    }

    users ||--o{ bonus_requests : "submits"
    users ||--o{ call_requests : "submits"
    users ||--o{ support_requests : "submits"
    users ||--o{ document_submissions : "uploads"
    users ||--o{ operators : "is"
    users ||--o{ operator_change_timelines : "modified"
    operators ||--o{ operator_change_timelines : "has logs"
    operator_groups ||--o{ operators : "contains"
`;

const KNOWN_TYPES = new Set(
  [
    "bigint",
    "int",
    "integer",
    "smallint",
    "serial",
    "uuid",
    "string",
    "varchar",
    "char",
    "text",
    "bool",
    "boolean",
    "float",
    "double",
    "decimal",
    "numeric",
    "date",
    "datetime",
    "timestamp",
    "time",
    "enum",
    "json",
    "jsonb",
  ].map((s) => s.toLowerCase()),
);

function tokenizePreservingQuotes(line: string) {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m[1] != null) tokens.push(`"${m[1]}"`);
    else if (m[2] != null) tokens.push(`'${m[2]}'`);
    else tokens.push(m[3]);
  }
  return tokens;
}

function unquote(s: string) {
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

function singularize(name: string) {
  return name.endsWith("s") && name.length > 1 ? name.slice(0, -1) : name;
}

function toCamelId(name: string) {
  const s = singularize(name);
  return s.replace(/_([a-z])/g, (_, c) => String(c).toUpperCase()) + "Id";
}

function parseCardToken(tok: string): Cardinality | undefined {
  const t = tok.trim();
  if (t === "||" || t === "|") return "one";
  if (t === "o|" || t === "|o") return "zeroOrOne";
  if (t === "|{" || t === "}|" || t === "}{") return "oneOrMany";
  if (t === "o{" || t === "}o") return "zeroOrMany";
  return undefined;
}

function maxMultiplicity(c?: Cardinality) {
  if (!c) return 1;
  return c === "one" || c === "zeroOrOne" ? 1 : Infinity;
}

function parseErdColumnLine(line: string): Column | null {
  const raw = line.trim();
  if (!raw || raw.startsWith("%") || raw.startsWith("//")) return null;

  const tokens = tokenizePreservingQuotes(raw);
  if (tokens.length < 2) return null;

  const upper = tokens.map((t) => t.toUpperCase());
  const isPK =
    upper.includes("PK") ||
    upper.includes("PRIMARY") ||
    upper.includes("PRIMARYKEY");
  const isFK =
    upper.includes("FK") ||
    upper.includes("FOREIGN") ||
    upper.includes("FOREIGNKEY");

  const quoted = tokens.find((t) => t.startsWith('"') || t.startsWith("'"));
  const note = quoted ? unquote(quoted) : undefined;

  const t0 = tokens[0].toLowerCase();
  const t1 = tokens[1].toLowerCase();

  let type = tokens[0];
  let name = tokens[1];

  if (!KNOWN_TYPES.has(t0) && KNOWN_TYPES.has(t1)) {
    name = tokens[0];
    type = tokens[1];
  }

  if (name === "PK" || name === "FK") return null;

  return {
    name,
    type,
    isPrimaryKey: isPK,
    isForeignKey: isFK,
    note,
  };
}

function pickParentPkColumn(parent: Table) {
  return parent.columns.find((c) => c.isPrimaryKey)?.name ?? "id";
}

function pickChildFkColumn(child: Table, parentName: string) {
  const candidates = [
    `${parentName}_id`,
    `${singularize(parentName)}_id`,
    `${singularize(parentName)}Id`,
    toCamelId(parentName),
  ].map((s) => s.toLowerCase());

  const fkCols = child.columns.filter((c) => c.isForeignKey);
  const byName =
    child.columns.find((c) => candidates.includes(c.name.toLowerCase())) ??
    fkCols.find((c) => candidates.includes(c.name.toLowerCase()));

  return byName?.name ?? fkCols[0]?.name ?? child.columns[0]?.name ?? "id";
}

export function parseErdDiagram(text: string): ParseResult {
  const lines = text.split(/\r?\n/);

  const tables: Table[] = [];
  const relationsRaw: Array<{
    left: string;
    leftCard?: Cardinality;
    right: string;
    rightCard?: Cardinality;
    label?: string;
  }> = [];

  let currentTable: Table | null = null;

  const relRe = new RegExp(
    String.raw`^([A-Za-z_]\w*)\s+(\|\||o\||\|o|o\{|\|\{)\s*(?:--|==|\.\.)\s*(\|\||o\||\|o|o\{|\|\{)\s+([A-Za-z_]\w*)(?:\s*:\s*(.+))?$`,
  );

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^erDiagram\b/i.test(t)) continue;

    const open = t.match(/^([A-Za-z_]\w*)\s*\{$/);
    if (open) {
      currentTable = { name: open[1], columns: [] };
      continue;
    }

    if (t === "}" && currentTable) {
      tables.push({
        ...currentTable,
        columns: currentTable.columns.length
          ? currentTable.columns
          : [{ name: "id", type: "bigint", isPrimaryKey: true }],
      });
      currentTable = null;
      continue;
    }

    if (currentTable) {
      const col = parseErdColumnLine(t);
      if (col) currentTable.columns.push(col);
      continue;
    }

    const m = t.match(relRe);
    if (m) {
      relationsRaw.push({
        left: m[1],
        leftCard: parseCardToken(m[2]),
        rightCard: parseCardToken(m[3]),
        right: m[4],
        label: m[5] ? unquote(m[5].trim()) : undefined,
      });
    }
  }

  const tableByName = new Map(tables.map((tb) => [tb.name, tb]));

  const relations: Relation[] = relationsRaw
    .map((r) => {
      const lt = tableByName.get(r.left);
      const rt = tableByName.get(r.right);
      if (!lt || !rt) return null;

      const leftMax = maxMultiplicity(r.leftCard);
      const rightMax = maxMultiplicity(r.rightCard);

      let parent = r.left;
      let child = r.right;
      let parentCard = r.leftCard;
      let childCard = r.rightCard;

      if (leftMax !== rightMax) {
        parent = leftMax === 1 ? r.left : r.right;
        child = parent === r.left ? r.right : r.left;
        parentCard = parent === r.left ? r.leftCard : r.rightCard;
        childCard = child === r.right ? r.rightCard : r.leftCard;
      }

      const parentTable = tableByName.get(parent)!;
      const childTable = tableByName.get(child)!;

      const toColumn = pickParentPkColumn(parentTable);
      const fromColumn = pickChildFkColumn(childTable, parent);

      const idx = childTable.columns.findIndex((c) => c.name === fromColumn);
      if (idx >= 0)
        childTable.columns[idx] = {
          ...childTable.columns[idx],
          isForeignKey: true,
        };

      return {
        fromTable: child,
        fromColumn,
        toTable: parent,
        toColumn,
        label: r.label,
        fromCardinality: childCard,
        toCardinality: parentCard,
      } satisfies Relation;
    })
    .filter(Boolean);

  return { tables, relations, format: "erd" };
}
