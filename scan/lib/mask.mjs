// Masks a secret for display. Shows at most the first 4 characters and always
// pads with a fixed number of stars, so the output does not reveal the length.
// Values of 8 characters or fewer show nothing at all.
export function mask(value) {
  const v = String(value);
  if (v.length <= 8) return "*".repeat(8);
  return v.slice(0, 4) + "*".repeat(8);
}
