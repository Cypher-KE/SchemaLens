export type DiagramFormat = "sql" | "erd";

export type Cardinality = "one" | "zeroOrOne" | "oneOrMany" | "zeroOrMany";

export type Column = {
  name: string;
  type: string;
  isPrimaryKey: boolean;
  isForeignKey?: boolean;
  note?: string;
};

export type Table = {
  name: string;
  columns: Column[];
};

export type Relation = {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;

  label?: string;
  fromCardinality?: Cardinality;
  toCardinality?: Cardinality;
};

export type ParseResult = {
  tables: Table[];
  relations: Relation[];
  format?: DiagramFormat;
};

export type Layout = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Point = { x: number; y: number };

export type RoutedEdge = {
  id: string;
  relation: Relation;
  points: Point[];
};
