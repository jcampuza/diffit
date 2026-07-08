export function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
