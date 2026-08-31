import type { SchemaSnapshot, SchemaDiff } from "@/lib/types";

export function diffSchemas(before: SchemaSnapshot, after: SchemaSnapshot): SchemaDiff {
  const beforeMap = new Map(before.tables.map((t) => [t.name, t]));
  const afterMap = new Map(after.tables.map((t) => [t.name, t]));

  const addedTables = [...afterMap.keys()].filter((n) => !beforeMap.has(n));
  const removedTables = [...beforeMap.keys()].filter((n) => !afterMap.has(n));

  const changedTables: SchemaDiff["changedTables"] = [];
  for (const [name, aTable] of afterMap) {
    const bTable = beforeMap.get(name);
    if (!bTable) continue;
    const bCols = new Set(bTable.columns.map((c) => c.name));
    const aCols = new Set(aTable.columns.map((c) => c.name));
    const addedColumns = [...aCols].filter((c) => !bCols.has(c));
    const removedColumns = [...bCols].filter((c) => !aCols.has(c));
    if (
      addedColumns.length ||
      removedColumns.length ||
      bTable.rowCount !== aTable.rowCount
    ) {
      changedTables.push({
        name,
        addedColumns,
        removedColumns,
        rowCountBefore: bTable.rowCount,
        rowCountAfter: aTable.rowCount,
      });
    }
  }

  return { addedTables, removedTables, changedTables };
}
