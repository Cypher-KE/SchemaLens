import { useMemo } from "react";
import { motion } from "framer-motion";
import { Table, Relation, Layout } from "../types";
import { getColumnY, LAYOUT_GAP_X, LAYOUT_GAP_Y } from "../utils/schemaParser";

type RelationLayerProps = {
  tables: Table[];
  layout: Record<string, Layout>;
  relations: Relation[];
  activeTable: string | null;
};

function pairKey(r: Relation) {
  return `${r.fromTable}::${r.toTable}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function RelationLayer({
  tables,
  layout,
  relations,
  activeTable,
}: RelationLayerProps) {
  const tableMap = useMemo(
    () => new Map(tables.map((t) => [t.name, t])),
    [tables],
  );

  const boxes = useMemo(() => Object.values(layout), [layout]);

  // --- derive column channels (x) from actual layout ---
  const colLefts = useMemo(() => {
    const xs = Array.from(new Set(boxes.map((b) => b.x))).sort((a, b) => a - b);
    return xs;
  }, [boxes]);

  const colBounds = useMemo(() => {
    // left -> right for each column
    return colLefts.map((x) => {
      const b = boxes.find((bb) => bb.x === x);
      const w = b?.width ?? 290;
      return { left: x, right: x + w };
    });
  }, [boxes, colLefts]);

  const xToColIndex = useMemo(() => {
    const m = new Map<number, number>();
    colLefts.forEach((x, i) => m.set(x, i));
    return m;
  }, [colLefts]);

  const colGaps = useMemo(() => {
    // gap between col i and col i+1
    const gaps = [];
    for (let i = 0; i < colBounds.length - 1; i++) {
      const min = colBounds[i].right;
      const max = colBounds[i + 1].left;
      gaps.push({ i, min, max, center: (min + max) / 2 });
    }
    return gaps;
  }, [colBounds]);

  // --- derive row channels (y) from actual layout ---
  const rowTops = useMemo(() => {
    const ys = Array.from(new Set(boxes.map((b) => b.y))).sort((a, b) => a - b);
    return ys;
  }, [boxes]);

  const rowBounds = useMemo(() => {
    return rowTops.map((top) => {
      const rowBoxes = boxes.filter((b) => b.y === top);
      const bottom =
        rowBoxes.length > 0
          ? Math.max(...rowBoxes.map((b) => b.y + b.height))
          : top;
      return { top, bottom };
    });
  }, [boxes, rowTops]);

  const yToRowIndex = useMemo(() => {
    const m = new Map<number, number>();
    rowTops.forEach((y, i) => m.set(y, i));
    return m;
  }, [rowTops]);

  const rowGaps = useMemo(() => {
    const gaps = [];
    for (let i = 0; i < rowBounds.length - 1; i++) {
      const min = rowBounds[i].bottom;
      const max = rowBounds[i + 1].top;
      gaps.push({ i, min, max, center: (min + max) / 2 });
    }
    return gaps;
  }, [rowBounds]);

  // parallel edge separation
  const pairCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of relations) {
      const k = pairKey(r);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  }, [relations]);

  const pairCursors = useMemo(() => new Map<string, number>(), [relations]);

  // styling + geometry
  const EDGE_GAP = 10;
  const STUB = 18;

  const ARROW_SIZE = 7;

  function pickVerticalChannelX(colIndex: number, preferDir: -1 | 1) {
    // preferDir=1 => channel to the right of this column; -1 => left
    if (colBounds.length <= 1) {
      // single column: use an outer channel
      const only = colBounds[0];
      const outer =
        preferDir === 1 ? only.right + LAYOUT_GAP_X : only.left - LAYOUT_GAP_X;
      return { center: outer, min: outer - 1, max: outer + 1 };
    }

    if (preferDir === 1) {
      // gap at same index is "to the right"
      const g = colGaps[colIndex];
      if (g) return g;
      // fallback to left
      const gl = colGaps[colIndex - 1];
      if (gl) return gl;
      // fallback outer
      const last = colBounds[colBounds.length - 1];
      const outer = last.right + LAYOUT_GAP_X;
      return { center: outer, min: outer - 1, max: outer + 1 };
    } else {
      const g = colGaps[colIndex - 1];
      if (g) return g;
      const gr = colGaps[colIndex];
      if (gr) return gr;
      const first = colBounds[0];
      const outer = first.left - LAYOUT_GAP_X;
      return { center: outer, min: outer - 1, max: outer + 1 };
    }
  }

  function pickHorizontalChannelY(rowIndex: number, preferDir: -1 | 1) {
    if (rowBounds.length <= 1) {
      const only = rowBounds[0];
      const outer =
        preferDir === 1 ? only.bottom + LAYOUT_GAP_Y : only.top - LAYOUT_GAP_Y;
      return { center: outer, min: outer - 1, max: outer + 1 };
    }

    if (preferDir === 1) {
      const g = rowGaps[rowIndex];
      if (g) return g;
      const gu = rowGaps[rowIndex - 1];
      if (gu) return gu;
      const last = rowBounds[rowBounds.length - 1];
      const outer = last.bottom + LAYOUT_GAP_Y;
      return { center: outer, min: outer - 1, max: outer + 1 };
    } else {
      const g = rowGaps[rowIndex - 1];
      if (g) return g;
      const gd = rowGaps[rowIndex];
      if (gd) return gd;
      const first = rowBounds[0];
      const outer = first.top - LAYOUT_GAP_Y;
      return { center: outer, min: outer - 1, max: outer + 1 };
    }
  }

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

      {relations.map((r, index) => {
        const fromTable = tableMap.get(r.fromTable);
        const toTable = tableMap.get(r.toTable);
        const fromBox = layout[r.fromTable];
        const toBox = layout[r.toTable];
        if (!fromTable || !toTable || !fromBox || !toBox) return null;

        const sourceY = getColumnY(fromTable, fromBox, r.fromColumn);
        const targetY = getColumnY(toTable, toBox, r.toColumn);

        const fromCol = xToColIndex.get(fromBox.x) ?? 0;
        const toCol = xToColIndex.get(toBox.x) ?? 0;

        const fromRow = yToRowIndex.get(fromBox.y) ?? 0;
        const toRow = yToRowIndex.get(toBox.y) ?? 0;

        // lane offset for parallel relations (apply to horizontal channel Y within its gap)
        const k = pairKey(r);
        const total = pairCounts.get(k) ?? 1;
        const cursor = pairCursors.get(k) ?? 0;
        pairCursors.set(k, cursor + 1);
        const lane = cursor - (total - 1) / 2;
        const laneOffset = lane * 10;

        // choose vertical channels adjacent to each card, facing the other
        const fromToDirX: -1 | 1 =
          toCol > fromCol ? 1 : toCol < fromCol ? -1 : 1;

        const toFromDirX: -1 | 1 =
          fromCol > toCol ? 1 : fromCol < toCol ? -1 : -1;

        const fromChan = pickVerticalChannelX(fromCol, fromToDirX);
        const toChan = pickVerticalChannelX(toCol, toFromDirX);

        const x1 = fromChan.center;
        const x2 = toChan.center;

        // horizontal channel choice: if different rows, route through a gap between rows.
        // if same row, route below if possible, else above.
        let preferY: -1 | 1;
        if (toRow > fromRow) preferY = 1;
        else if (toRow < fromRow) preferY = -1;
        else preferY = 1;

        const baseRow =
          toRow > fromRow ? fromRow : fromRow > toRow ? toRow : fromRow;
        const yChan = pickHorizontalChannelY(baseRow, preferY);

        const channelY = clamp(
          yChan.center + laneOffset,
          yChan.min + 6,
          yChan.max - 6,
        );

        // determine which side we exit/enter each card based on its channel
        const fromCenterX = fromBox.x + fromBox.width / 2;
        const fromExitDir: -1 | 1 = x1 >= fromCenterX ? 1 : -1;

        const toCenterX = toBox.x + toBox.width / 2;
        // if channel is left of target, we approach from left (dir=1), else from right (dir=-1)
        const toApproachDir: -1 | 1 = x2 <= toCenterX ? 1 : -1;

        const startEdgeX = fromBox.x + (fromExitDir === 1 ? fromBox.width : 0);
        const startX = startEdgeX + fromExitDir * EDGE_GAP;
        const startStubX = startX + fromExitDir * STUB;

        const endEdgeX = toBox.x + (toApproachDir === 1 ? 0 : toBox.width);
        const endX = endEdgeX - toApproachDir * EDGE_GAP;
        const endStubX = endX - toApproachDir * STUB;

        // IMPORTANT: long segments run only in channels (x1/x2 and channelY), never through card areas
        const path = `M ${startX} ${sourceY}
                      L ${startStubX} ${sourceY}
                      L ${x1} ${sourceY}
                      L ${x1} ${channelY}
                      L ${x2} ${channelY}
                      L ${x2} ${targetY}
                      L ${endStubX} ${targetY}
                      L ${endX} ${targetY}`;

        const isActive =
          !activeTable ||
          r.fromTable === activeTable ||
          r.toTable === activeTable;

        const stroke = isActive
          ? "hsl(var(--accent-2))"
          : "hsl(var(--muted-fg))";

        return (
          <motion.path
            key={`${r.fromTable}-${r.fromColumn}-${r.toTable}-${r.toColumn}-${index}`}
            d={path}
            fill="none"
            stroke={stroke}
            strokeWidth={isActive ? 1.9 : 1.05}
            opacity={isActive ? 0.85 : 0.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            markerEnd="url(#arrow)"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: isActive ? 0.85 : 0.2 }}
            transition={{ duration: 0.55, delay: index * 0.015 }}
          />
        );
      })}
    </svg>
  );
}
