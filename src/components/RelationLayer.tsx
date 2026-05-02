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
import { getColumnY } from "../utils/schemaParser";

type RelationLayerProps = {
  mode: DiagramFormat;
  tables: Table[];
  layout: Record<string, Layout>;
  relations: Relation[];
  activeTable: string | null;
  routes?: RoutedEdge[];
};

const ARROW_SIZE = 10;
const ERD_MARKER = 16;

function polylineD(points: Point[]) {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

function roundedOrthogonalD(points: Point[], radius = 16) {
  const pts = points;
  if (pts.length < 2) return "";

  const sign = (v: number) => (v === 0 ? 0 : v > 0 ? 1 : -1);

  let d = `M ${pts[0].x} ${pts[0].y}`;

  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];

    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const bcx = c.x - b.x;
    const bcy = c.y - b.y;

    const isCorner =
      (sign(abx) !== 0 && sign(bcy) !== 0) ||
      (sign(aby) !== 0 && sign(bcx) !== 0);

    if (!isCorner) {
      d += ` L ${b.x} ${b.y}`;
      continue;
    }

    const abLen = Math.hypot(abx, aby);
    const bcLen = Math.hypot(bcx, bcy);

    const r = Math.min(radius, abLen / 2, bcLen / 2);
    if (r <= 0.5) {
      d += ` L ${b.x} ${b.y}`;
      continue;
    }

    const p1 = { x: b.x - sign(abx) * r, y: b.y - sign(aby) * r };
    const p2 = { x: b.x + sign(bcx) * r, y: b.y + sign(bcy) * r };

    d += ` L ${p1.x} ${p1.y}`;
    d += ` Q ${b.x} ${b.y} ${p2.x} ${p2.y}`;
  }

  const last = pts[pts.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

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

    const sx = fromB.x + fromB.width / 2;
    const sy = getColumnY(fromT, fromB, r.fromColumn);
    const tx = toB.x + toB.width / 2;
    const ty = getColumnY(toT, toB, r.toColumn);

    const midY = (sy + ty) / 2;

    out.push({
      id: `fallback:${i}`,
      relation: r,
      points: [
        { x: sx, y: sy },
        { x: sx, y: midY },
        { x: tx, y: midY },
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
          refX={ARROW_SIZE - 0.25}
          refY={ARROW_SIZE / 2}
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path
            d={`M0,0 L${ARROW_SIZE},${ARROW_SIZE / 2} L0,${ARROW_SIZE} Z`}
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
                    d="M4 3 L4 13"
                    stroke="context-stroke"
                    strokeWidth="1.8"
                  />
                  <path
                    d="M7 3 L7 13"
                    stroke="context-stroke"
                    strokeWidth="1.8"
                  />
                </>
              )}
              {c === "zeroOrOne" && (
                <>
                  <circle
                    cx="6"
                    cy="8"
                    r="2.5"
                    fill="none"
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                  <path
                    d="M12 3 L12 13"
                    stroke="context-stroke"
                    strokeWidth="1.8"
                  />
                </>
              )}
              {c === "oneOrMany" && (
                <>
                  <path
                    d="M6 3 L6 13"
                    stroke="context-stroke"
                    strokeWidth="1.8"
                  />
                  <path
                    d="M0 8 L4 8"
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                  <path
                    d="M0 8 L4 4"
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                  <path
                    d="M0 8 L4 12"
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                </>
              )}
              {c === "zeroOrMany" && (
                <>
                  <circle
                    cx="8"
                    cy="8"
                    r="2.5"
                    fill="none"
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                  <path
                    d="M0 8 L4 8"
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                  <path
                    d="M0 8 L4 4"
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                  <path
                    d="M0 8 L4 12"
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
                    d={`M${ERD_MARKER - 4} 3 L${ERD_MARKER - 4} 13`}
                    stroke="context-stroke"
                    strokeWidth="1.8"
                  />
                  <path
                    d={`M${ERD_MARKER - 7} 3 L${ERD_MARKER - 7} 13`}
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
                    r="2.5"
                    fill="none"
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                  <path
                    d={`M${ERD_MARKER - 12} 3 L${ERD_MARKER - 12} 13`}
                    stroke="context-stroke"
                    strokeWidth="1.8"
                  />
                </>
              )}
              {c === "oneOrMany" && (
                <>
                  <path
                    d={`M${ERD_MARKER - 6} 3 L${ERD_MARKER - 6} 13`}
                    stroke="context-stroke"
                    strokeWidth="1.8"
                  />
                  <path
                    d={`${ERD_MARKER} 8 L${ERD_MARKER - 4} 8`}
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                  <path
                    d={`${ERD_MARKER} 8 L${ERD_MARKER - 4} 4`}
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                  <path
                    d={`${ERD_MARKER} 8 L${ERD_MARKER - 4} 12`}
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
                    r="2.5"
                    fill="none"
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                  <path
                    d={`${ERD_MARKER} 8 L${ERD_MARKER - 4} 8`}
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                  <path
                    d={`${ERD_MARKER} 8 L${ERD_MARKER - 4} 4`}
                    stroke="context-stroke"
                    strokeWidth="1.6"
                  />
                  <path
                    d={`${ERD_MARKER} 8 L${ERD_MARKER - 4} 12`}
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

        const d =
          mode === "erd"
            ? roundedOrthogonalD(r.points, 16)
            : roundedOrthogonalD(r.points, 12);

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
              strokeWidth={
                mode === "erd"
                  ? isActive
                    ? 1.45
                    : 1.0
                  : isActive
                    ? 2.05
                    : 1.15
              }
              opacity={isActive ? (mode === "erd" ? 0.92 : 0.9) : 0.16}
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
              animate={{
                pathLength: 1,
                opacity: isActive ? (mode === "erd" ? 0.92 : 0.9) : 0.16,
              }}
              transition={{ duration: 0.55, delay: index * 0.01 }}
            />

            {mode === "erd" && rel.label && labelPoint && (
              <text
                x={labelPoint.x}
                y={labelPoint.y - 8}
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
