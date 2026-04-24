export type Column = {
  name: string;
  type: string;
  isPrimaryKey: boolean;
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
};

export type ParseResult = {
  tables: Table[];
  relations: Relation[];
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
