import { useMemo } from "react";
import { motion } from "framer-motion";
import { Table, Relation, Layout } from "../types";
import { getColumnY } from "../utils/schemaParser";

type RelationLayerProps = {
  tables: Table[];
  layout: Record<string, Layout>;
  relations: Relation[];
  activeTable: string | null;
};

export default function RelationLayer({
  tables,
  layout,
  relations,
  activeTable,
}: RelationLayerProps) {
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
