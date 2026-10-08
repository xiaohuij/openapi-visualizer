import YAML from "yaml";

interface SourceNode {
  range?: [number, number, number];
}

function pointerSegments(pointer: string) {
  return pointer
    .replace(/^#/, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

export function arazzoSourceSnippet(sourceText: string, pointer: string, maxLines = 18) {
  const document = YAML.parseDocument(sourceText);
  if (document.errors.length > 0) return undefined;

  const node = document.getIn(pointerSegments(pointer), true) as SourceNode | undefined;
  if (!node?.range) return undefined;

  const snippet = sourceText.slice(node.range[0], node.range[1]).trim();
  const lines = snippet.split(/\r?\n/);
  if (lines.length <= maxLines) return snippet;
  return `${lines.slice(0, maxLines).join("\n")}\n…`;
}
