/** One uniform of a program's table: its name, whether it is an int or sampler unit, and where its value lies. */
export interface TableEntry {
  readonly name: string;
  readonly int: boolean;
  readonly offset: number;
  readonly size: number;
}

/**
 * Reads a uniform table as generated.ts writes it (`SKY_UNIFORMS`), independently of `Program`: space-separated
 * entries, each a kind (`f`, `i`, or a vector's component count) and a name, with values one after another.
 */
export function readUniformTable(table: string): TableEntry[] {
  const entries: TableEntry[] = [];
  let offset = 0;
  for (const [, kind = "", name = ""] of table.matchAll(/([fi234])(\w+)/g)) {
    const size = kind === "f" || kind === "i" ? 1 : Number(kind);
    entries.push({ name, int: kind === "i", offset, size });
    offset += size;
  }
  return entries;
}
