import ELK from "elkjs/lib/elk.bundled.js";
import type {
  DiagramFormat,
  Layout,
  LayoutDirection,
  Relation,
  RoutedEdge,
  Table,
} from "../types";
import { buildErdLayout } from "./elk/erdLayout";
import { buildSqlLayout } from "./elk/sqlLayout";

export type BuildElkResult = {
  layout: Record<string, Layout>;
  edges: RoutedEdge[];
  size: { width: number; height: number };
};

export async function buildOptimalLayoutElk(
  tables: Table[],
  relations: Relation[],
  options?: {
    availableWidth?: number;
    mode?: DiagramFormat;
    direction?: LayoutDirection;
  },
): Promise<BuildElkResult> {
  const elk = new ELK();
  const mode: DiagramFormat = options?.mode ?? "sql";
  const availableWidth = Math.max(520, options?.availableWidth ?? 1200);

  if (mode === "erd") {
    return buildErdLayout(elk, tables, relations, {
      availableWidth,
      direction: options?.direction ?? "vertical",
    });
  }

  return buildSqlLayout(elk, tables, relations, {
    availableWidth,
    direction: options?.direction ?? "horizontal",
  });
}
