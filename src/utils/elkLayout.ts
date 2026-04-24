import ELK from "elkjs/lib/elk.bundled.js";
import type { Layout, Relation, RoutedEdge, Table } from "../types";
import {
  getTableHeight,
  TABLE_HEADER_HEIGHT,
  TABLE_ROW_HEIGHT,
  TABLE_WIDTH,
  LAYOUT_PADDING,
} from "./schemaParser";

type BuildElkResult = {
  layout: Record<string, Layout>;
  edges: RoutedEdge[];
  size: { width: number; height: number };
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function getColumnCenterY(table: Table, columnName: string) {
  const idx = table.columns.findIndex((c) => c.name === columnName);
  const safe = idx >= 0 ? idx : 0;
  return TABLE_HEADER_HEIGHT + safe * TABLE_ROW_HEIGHT + TABLE_ROW_HEIGHT / 2;
}

/**
 * ELK layered layout + ORTHOGONAL routing.
 * We layout edges from referenced(table) -> referencing(table) for cleaner layers,
 * but we return the polyline reversed so your arrow still points FK -> PK (child -> parent).
 */
export async function buildOptimalLayoutElk(
  tables: Table[],
  relations: Relation[],
): Promise<BuildElkResult> {
  const elk = new ELK();

  const tableByName = new Map(tables.map((t) => [t.name, t]));

  // --- Build per-endpoint port definitions with small offsets to prevent same-row overlap ---
  type Endpoint = {
    relIndex: number;
    role: "PARENT_SRC" | "CHILD_TGT"; // direction inside ELK
    tableName: string;
    columnName: string;
    side: "EAST" | "WEST";
    baseY: number;
    portId: string;
  };

  const endpointsByKey = new Map<string, Endpoint[]>();
  const endpoints: Endpoint[] = [];

  relations.forEach((r, i) => {
    const child = tableByName.get(r.fromTable);
    const parent = tableByName.get(r.toTable);
    if (!child || !parent) return;

    // ELK edge direction: parent -> child (left-to-right layered graph)
    const parentBaseY = getColumnCenterY(parent, r.toColumn);
    const childBaseY = getColumnCenterY(child, r.fromColumn);

    const parentEp: Endpoint = {
      relIndex: i,
      role: "PARENT_SRC",
      tableName: r.toTable,
      columnName: r.toColumn,
      side: "EAST",
      baseY: parentBaseY,
      portId: `port:parent:${i}`,
    };

    const childEp: Endpoint = {
      relIndex: i,
      role: "CHILD_TGT",
      tableName: r.fromTable,
      columnName: r.fromColumn,
      side: "WEST",
      baseY: childBaseY,
      portId: `port:child:${i}`,
    };

    const k1 = `${parentEp.tableName}|${parentEp.columnName}|${parentEp.side}`;
    const k2 = `${childEp.tableName}|${childEp.columnName}|${childEp.side}`;

    if (!endpointsByKey.has(k1)) endpointsByKey.set(k1, []);
    if (!endpointsByKey.has(k2)) endpointsByKey.set(k2, []);

    endpointsByKey.get(k1)!.push(parentEp);
    endpointsByKey.get(k2)!.push(childEp);

    endpoints.push(parentEp, childEp);
  });

  // Compute port Y offsets within the row height so multiple edges from same column don’t sit on top of each other.
  const portPositions = new Map<
    string,
    { x: number; y: number; side: "EAST" | "WEST" }
  >();

  for (const group of endpointsByKey.values()) {
    group.sort((a, b) => a.relIndex - b.relIndex);

    const count = group.length;
    const step = 5; // px separation between ports in same column

    for (let j = 0; j < group.length; j++) {
      const ep = group[j];
      const t = tableByName.get(ep.tableName);
      if (!t) continue;

      // center around baseY
      const lane = j - (count - 1) / 2;
      const y = ep.baseY + lane * step;

      // keep within the row bounds a bit
      const colIdx = Math.max(
        0,
        t.columns.findIndex((c) => c.name === ep.columnName),
      );
      const rowTop = TABLE_HEADER_HEIGHT + colIdx * TABLE_ROW_HEIGHT;
      const rowBottom = rowTop + TABLE_ROW_HEIGHT;
      const yClamped = clamp(y, rowTop + 6, rowBottom - 6);

      const x = ep.side === "EAST" ? TABLE_WIDTH : 0;

      portPositions.set(ep.portId, { x, y: yClamped, side: ep.side });
    }
  }

  // --- Build ELK nodes (tables) with ports ---
  const elkNodes = tables.map((t) => {
    const ports = endpoints
      .filter((ep) => ep.tableName === t.name)
      .map((ep) => {
        const pos = portPositions.get(ep.portId)!;
        return {
          id: ep.portId,
          width: 1,
          height: 1,
          x: pos.x,
          y: pos.y,
          layoutOptions: {
            "elk.port.side": pos.side,
          },
        };
      });

    return {
      id: t.name,
      width: TABLE_WIDTH,
      height: getTableHeight(t),
      ports,
      layoutOptions: {
        // respect our port x/y exactly
        "elk.portConstraints": "FIXED_POS",
      },
    };
  });

  // --- Build ELK edges (parent -> child) ---
  const elkEdges = relations
    .map((r, i) => {
      const child = tableByName.get(r.fromTable);
      const parent = tableByName.get(r.toTable);
      if (!child || !parent) return null;

      const id = `edge:${i}`;

      return {
        id,
        sources: [`port:parent:${i}`],
        targets: [`port:child:${i}`],
      };
    })
    .filter(Boolean);

  const graph: any = {
    id: "root",
    children: elkNodes,
    edges: elkEdges,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",

      // orthogonal edges like ERD tools
      "elk.edgeRouting": "ORTHOGONAL",

      // More aggressive (tighter) placement but still readable:
      "elk.padding": `[top=${LAYOUT_PADDING},left=${LAYOUT_PADDING},bottom=${LAYOUT_PADDING},right=${LAYOUT_PADDING}]`,
      "elk.spacing.nodeNode": "28",
      "elk.layered.spacing.nodeNodeBetweenLayers": "56",

      // Make edges easier to follow (separate them):
      "elk.spacing.edgeEdge": "16",
      "elk.spacing.edgeNode": "18",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "18",

      // Better crossing minimization
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    },
  };

  const out = await elk.layout(graph);

  // --- Node layout map ---
  const layout: Record<string, Layout> = {};
  for (const n of out.children ?? []) {
    layout[n.id] = {
      x: n.x ?? 0,
      y: n.y ?? 0,
      width: n.width ?? TABLE_WIDTH,
      height: n.height ?? 0,
    };
  }

  // --- Routed edges as polylines ---
  const routed: RoutedEdge[] = (out.edges ?? [])
    .map((e: any) => {
      const idx = Number(String(e.id).split(":")[1]);
      const relation = relations[idx];
      if (!relation) return null;

      const sec = e.sections?.[0];
      if (!sec?.startPoint || !sec?.endPoint) return null;

      const pts = [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint].map(
        (p: any) => ({ x: p.x, y: p.y }),
      );

      // ELK is parent->child; reverse so it visually points FK(fromTable)->PK(toTable) if you keep markerEnd.
      pts.reverse();

      return {
        id: e.id,
        relation,
        points: pts,
      } satisfies RoutedEdge;
    })
    .filter(Boolean);

  // --- Canvas size: include edge points so nothing clips ---
  let maxX = 0;
  let maxY = 0;
  for (const b of Object.values(layout)) {
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  for (const ed of routed) {
    for (const p of ed.points) {
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }

  return {
    layout,
    edges: routed,
    size: {
      width: Math.ceil(maxX + LAYOUT_PADDING),
      height: Math.ceil(maxY + LAYOUT_PADDING),
    },
  };
}
