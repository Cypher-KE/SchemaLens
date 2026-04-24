import { motion } from "framer-motion";
import type { Relation, RoutedEdge, Table, Layout } from "../types";

type RelationLayerProps = {
  tables: Table[];
  layout: Record<string, Layout>;
  relations: Relation[];
  activeTable: string | null;
  routes?: RoutedEdge[];
};

const ARROW_SIZE = 7;

export default function RelationLayer({
  relations,
  activeTable,
  routes,
}: RelationLayerProps) {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
      <defs>
        <marker
          id="arrow"
          viewBox={`0 0 ${ARROW_SIZE} ${ARROW_SIZE}`}
          markerWidth={ARROW_SIZE}
          markerHeight={ARROW_SIZE}
          refX={ARROW_SIZE}
          refY={ARROW_SIZE / 2}
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path
            d={`M0,0 L${ARROW_SIZE},${ARROW_SIZE / 2} L0,${ARROW_SIZE} Z`}
            fill="context-stroke"
          />
        </marker>
      </defs>

      {(routes ?? []).map((r, index) => {
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

        return (
          <motion.path
            key={`${r.id}-${index}`}
            d={d}
            fill="none"
            stroke={stroke}
            strokeWidth={isActive ? 1.9 : 1.05}
            opacity={isActive ? 0.85 : 0.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            markerEnd="url(#arrow)"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: isActive ? 0.85 : 0.2 }}
            transition={{ duration: 0.55, delay: index * 0.01 }}
          />
        );
      })}
    </svg>
  );
}
