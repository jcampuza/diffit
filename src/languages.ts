import { setCustomExtension, type SupportedLanguages } from "@pierre/diffs";

const LANGUAGE_EXTENSIONS: Record<string, SupportedLanguages> = {
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  go: "go",
  h: "objective-c",
  hpp: "cpp",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsonc: "jsonc",
  jsx: "jsx",
  kt: "kotlin",
  kts: "kotlin",
  m: "objective-c",
  md: "markdown",
  mdx: "mdx",
  mm: "objective-cpp",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "shellscript",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  txt: "text",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
};

let configured = false;

export function configureDiffLanguages() {
  if (configured) {
    return;
  }

  for (const [extension, language] of Object.entries(LANGUAGE_EXTENSIONS)) {
    setCustomExtension(extension, language);
  }

  configured = true;
}
