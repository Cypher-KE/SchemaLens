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

export async function buildOptimalLayoutElk(
  tables: Table[],
  relations: Relation[],
  options?: { availableWidth?: number },
): Promise<BuildElkResult> {
  const elk = new ELK();
  const tableByName = new Map(tables.map((t) => [t.name, t]));

  const availableWidth = Math.max(520, options?.availableWidth ?? 1200);
  const targetWrapWidth = Math.max(520, availableWidth - LAYOUT_PADDING * 2);

  type Endpoint = {
    relIndex: number;
    role: "PARENT_SRC" | "CHILD_TGT";
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

  const portPositions = new Map<
    string,
    { x: number; y: number; side: "EAST" | "WEST" }
  >();

  for (const group of endpointsByKey.values()) {
    group.sort((a, b) => a.relIndex - b.relIndex);

    const count = group.length;
    const step = 5;

    for (let j = 0; j < group.length; j++) {
      const ep = group[j];
      const t = tableByName.get(ep.tableName);
      if (!t) continue;

      const lane = j - (count - 1) / 2;
      const y = ep.baseY + lane * step;

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
          layoutOptions: { "elk.port.side": pos.side },
        };
      });

    return {
      id: t.name,
      width: TABLE_WIDTH,
      height: getTableHeight(t),
      ports,
      layoutOptions: { "elk.portConstraints": "FIXED_POS" },
    };
  });

  const elkEdges = relations
    .map((r, i) => {
      const child = tableByName.get(r.fromTable);
      const parent = tableByName.get(r.toTable);
      if (!child || !parent) return null;

      return {
        id: `edge:${i}`,
        sources: [`port:parent:${i}`],
        targets: [`port:child:${i}`],
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    sources: string[];
    targets: string[];
  }>;

  const graph: any = {
    id: "root",
    children: elkNodes,
    edges: elkEdges,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",

      "elk.padding": `[top=${LAYOUT_PADDING},left=${LAYOUT_PADDING},bottom=${LAYOUT_PADDING},right=${LAYOUT_PADDING}]`,

      "elk.spacing.nodeNode": "18",
      "elk.layered.spacing.nodeNodeBetweenLayers": "44",

      "elk.spacing.edgeEdge": "18",
      "elk.spacing.edgeNode": "18",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "18",

      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.layering.strategy": "NETWORK_SIMPLEX",
      "elk.layered.cycleBreaking.strategy": "GREEDY",

      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
      "elk.layered.nodePlacement.favorStraightEdges": "true",

      "elk.layered.compaction.postCompaction.strategy": "EDGE_LENGTH",

      "elk.layered.wrapping.strategy": "MULTI_EDGE",
      "elk.layered.wrapping.targetWidth": String(targetWrapWidth),
    },
  };

  const out = await elk.layout(graph);

  const layout: Record<string, Layout> = {};
  for (const n of out.children ?? []) {
    layout[n.id] = {
      x: n.x ?? 0,
      y: n.y ?? 0,
      width: n.width ?? TABLE_WIDTH,
      height: n.height ?? 0,
    };
  }

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

      pts.reverse();

      return { id: e.id, relation, points: pts } satisfies RoutedEdge;
    })
    .filter(Boolean);

  let minX = Infinity;
  let minY = Infinity;

  for (const b of Object.values(layout)) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
  }
  for (const ed of routed) {
    for (const p of ed.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
    }
  }

  if (!Number.isFinite(minX)) minX = 0;
  if (!Number.isFinite(minY)) minY = 0;

  const shiftX = LAYOUT_PADDING - minX;
  const shiftY = LAYOUT_PADDING - minY;

  for (const k of Object.keys(layout)) {
    layout[k] = {
      ...layout[k],
      x: layout[k].x + shiftX,
      y: layout[k].y + shiftY,
    };
  }

  for (const ed of routed) {
    ed.points = ed.points.map((p) => ({ x: p.x + shiftX, y: p.y + shiftY }));
  }

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
