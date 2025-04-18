import map from "obliterator/map.js";

/** Convert integer to decimal string and pad to specific length. */
export function decPad(n: number | bigint, maxLength: number): string {
  return n.toString(10).padStart(maxLength, "0");
}

/** Convert integer to hexadecimal string and pad to specific length. */
export function hexPad(n: number | bigint, maxLength: number): string {
  return n.toString(16).toUpperCase().padStart(maxLength, "0");
}

/** Indent every line. */
export function* indentLines(lines: Iterable<string>, prefix = "  "): Iterable<string> {
  yield* map(lines, (line) => line === "" ? line : `${prefix}${line}`);
}
