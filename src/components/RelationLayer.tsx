import { motion } from "framer-motion";
import type {
  Cardinality,
  DiagramFormat,
  Relation,
  RoutedEdge,
  Table,
  Layout,
  Point,
} from "../types";
import { getColumnY, TABLE_WIDTH } from "../utils/schemaParser";

type RelationLayerProps = {
  mode: DiagramFormat;
  tables: Table[];
  layout: Record<string, Layout>;
  relations: Relation[];
  activeTable: string | null;
  routes?: RoutedEdge[];
};

const ARROW_SIZE = 7;
const ERD_MARKER = 18;

function midPointAlongPolyline(points: Point[]): Point | null {
  if (points.length < 2) return null;

  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += Math.hypot(
      points[i + 1].x - points[i].x,
      points[i + 1].y - points[i].y,
    );
  }
  if (!total) return points[0];

  const target = total / 2;
  let acc = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + seg >= target) {
      const t = (target - acc) / (seg || 1);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    acc += seg;
  }

  return points[Math.floor(points.length / 2)] ?? null;
}

function markerId(card: Cardinality | undefined, end: "start" | "end") {
  if (!card) return undefined;
  return `erd-${card}-${end}`;
}

function buildFallbackRoutes(
  tables: Table[],
  layout: Record<string, Layout>,
  relations: Relation[],
): RoutedEdge[] {
  const tableByName = new Map(tables.map((t) => [t.name, t]));

  const out: RoutedEdge[] = [];
  relations.forEach((r, i) => {
    const fromT = tableByName.get(r.fromTable);
    const toT = tableByName.get(r.toTable);
    const fromB = layout[r.fromTable];
    const toB = layout[r.toTable];
    if (!fromT || !toT || !fromB || !toB) return;

    const fromY = getColumnY(fromT, fromB, r.fromColumn);
    const toY = getColumnY(toT, toB, r.toColumn);

    const fromIsLeft = fromB.x + fromB.width < toB.x;
    const fromIsRight = toB.x + toB.width < fromB.x;

    const sx = fromIsLeft
      ? fromB.x + fromB.width
      : fromIsRight
        ? fromB.x
        : fromB.x + fromB.width;
    const tx = fromIsLeft ? toB.x : fromIsRight ? toB.x + toB.width : toB.x;

    const sy = fromY;
    const ty = toY;

    const mx = (sx + tx) / 2;

    out.push({
      id: `fallback:${i}`,
      relation: r,
      points: [
        { x: sx, y: sy },
        { x: mx, y: sy },
        { x: mx, y: ty },
        { x: tx, y: ty },
      ],
    });
  });

  return out;
}

export default function RelationLayer({
  mode,
  tables,
  layout,
  relations,
  activeTable,
  routes,
}: RelationLayerProps) {
  const edges =
    (routes?.length
      ? routes
      : buildFallbackRoutes(tables, layout, relations)) ?? [];

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
      <defs>
        <marker
          id="arrow"
          viewBox={`0 0 ${ARROW_SIZE} ${ARROW_SIZE}`}
          markerWidth={ARROW_SIZE}
          markerHeight={ARROW_SIZE}
          refX={ARROW_SIZE - 0.5}
          refY={ARROW_SIZE / 2}
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path
            d={`M-1,0 L${ARROW_SIZE},${ARROW_SIZE / 2} L-1,${ARROW_SIZE} Z`}
            fill="context-stroke"
          />
        </marker>

        {(["one", "zeroOrOne", "oneOrMany", "zeroOrMany"] as Cardinality[]).map(
          (c) => (
            <marker
              key={`start-${c}`}
              id={`erd-${c}-start`}
              viewBox={`0 0 ${ERD_MARKER} ${ERD_MARKER}`}
              markerWidth={ERD_MARKER}
              markerHeight={ERD_MARKER}
              refX={0}
              refY={ERD_MARKER / 2}
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              {c === "one" && (
                <>
                  <path
                    d="M4 3 L4 15"
                    stroke="context-stroke"
                    strokeWidth="1.8"
                  />
                  <path
                    d="M7 3 L7 15"
                    stroke="context-stroke"
                    strokeWidth="1.8"
                  />
                </>
              )}
              {c === "zeroOrOne" && (
                <>
                  <circle
                    cx="6"
                    cy="9"
                    r="2.6"
                    fill="none"
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                  <path
                    d="M12 3 L12 15"
                    stroke="context-stroke"
                    strokeWidth="1.8"
                  />
                </>
              )}
              {c === "oneOrMany" && (
                <>
                  <path
                    d="M6 3 L6 15"
                    stroke="context-stroke"
                    strokeWidth="1.8"
                  />
                  <path
                    d="M0 9 L4 9"
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                  <path
                    d="M0 9 L4 4"
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                  <path
                    d="M0 9 L4 14"
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                </>
              )}
              {c === "zeroOrMany" && (
                <>
                  <circle
                    cx="8"
                    cy="9"
                    r="2.6"
                    fill="none"
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                  <path
                    d="M0 9 L4 9"
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                  <path
                    d="M0 9 L4 4"
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                  <path
                    d="M0 9 L4 14"
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                </>
              )}
            </marker>
          ),
        )}

        {(["one", "zeroOrOne", "oneOrMany", "zeroOrMany"] as Cardinality[]).map(
          (c) => (
            <marker
              key={`end-${c}`}
              id={`erd-${c}-end`}
              viewBox={`0 0 ${ERD_MARKER} ${ERD_MARKER}`}
              markerWidth={ERD_MARKER}
              markerHeight={ERD_MARKER}
              refX={ERD_MARKER}
              refY={ERD_MARKER / 2}
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              {c === "one" && (
                <>
                  <path
                    d={`M${ERD_MARKER - 4} 3 L${ERD_MARKER - 4} 15`}
                    stroke="context-stroke"
                    strokeWidth="1.8"
                  />
                  <path
                    d={`M${ERD_MARKER - 7} 3 L${ERD_MARKER - 7} 15`}
                    stroke="context-stroke"
                    strokeWidth="1.8"
                  />
                </>
              )}
              {c === "zeroOrOne" && (
                <>
                  <circle
                    cx={ERD_MARKER - 6}
                    cy={ERD_MARKER / 2}
                    r="2.6"
                    fill="none"
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                  <path
                    d={`M${ERD_MARKER - 12} 3 L${ERD_MARKER - 12} 15`}
                    stroke="context-stroke"
                    strokeWidth="1.8"
                  />
                </>
              )}
              {c === "oneOrMany" && (
                <>
                  <path
                    d={`M${ERD_MARKER - 6} 3 L${ERD_MARKER - 6} 15`}
                    stroke="context-stroke"
                    strokeWidth="1.8"
                  />
                  <path
                    d={`${ERD_MARKER} 9 L${ERD_MARKER - 4} 9`}
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                  <path
                    d={`${ERD_MARKER} 9 L${ERD_MARKER - 4} 4`}
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                  <path
                    d={`${ERD_MARKER} 9 L${ERD_MARKER - 4} 14`}
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                </>
              )}
              {c === "zeroOrMany" && (
                <>
                  <circle
                    cx={ERD_MARKER - 8}
                    cy={ERD_MARKER / 2}
                    r="2.6"
                    fill="none"
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                  <path
                    d={`${ERD_MARKER} 9 L${ERD_MARKER - 4} 9`}
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                  <path
                    d={`${ERD_MARKER} 9 L${ERD_MARKER - 4} 4`}
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                  <path
                    d={`${ERD_MARKER} 9 L${ERD_MARKER - 4} 14`}
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                </>
              )}
            </marker>
          ),
        )}
      </defs>

      {edges.map((r, index) => {
        const rel = r.relation;

        const isActive =
          !activeTable ||
          rel.fromTable === activeTable ||
          rel.toTable === activeTable;

        const stroke = isActive
          ? "hsl(var(--accent-2))"
          : "hsl(var(--muted-fg))";

        const d = r.points
          .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
          .join(" ");

        const labelPoint = rel.label ? midPointAlongPolyline(r.points) : null;

        const mStart =
          mode === "erd" ? markerId(rel.fromCardinality, "start") : undefined;
        const mEnd =
          mode === "erd" ? markerId(rel.toCardinality, "end") : undefined;

        return (
          <g key={`${r.id}-${index}`}>
            <motion.path
              d={d}
              fill="none"
              stroke={stroke}
              strokeWidth={isActive ? 1.9 : 1.05}
              opacity={isActive ? 0.88 : 0.18}
              strokeLinecap="round"
              strokeLinejoin="round"
              markerEnd={
                mode === "sql"
                  ? "url(#arrow)"
                  : mEnd
                    ? `url(#${mEnd})`
                    : undefined
              }
              markerStart={
                mode === "erd" && mStart ? `url(#${mStart})` : undefined
              }
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: isActive ? 0.88 : 0.18 }}
              transition={{ duration: 0.55, delay: index * 0.01 }}
            />

            {mode === "erd" && rel.label && labelPoint && (
              <text
                x={labelPoint.x}
                y={labelPoint.y - 6}
                textAnchor="middle"
                fontSize="11"
                fill={stroke}
                opacity={isActive ? 0.95 : 0.25}
                style={{
                  paintOrder: "stroke",
                  stroke: "hsl(var(--card))",
                  strokeWidth: 6,
                }}
              >
                {rel.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
