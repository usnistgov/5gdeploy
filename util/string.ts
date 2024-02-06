export function decPad(n: number | bigint, maxLength: number): string {
  return n.toString(10).padStart(maxLength, "0");
}

export function hexPad(n: number | bigint, maxLength: number): string {
  return n.toString(16).toUpperCase().padStart(maxLength, "0");
}
