export type ArazzoDiagnosticSeverity = "error" | "warning" | "info";

export interface ArazzoDiagnostic {
  code: string;
  severity: ArazzoDiagnosticSeverity;
  message: string;
  pointer: string;
  documentId?: string;
}

export function arazzoError(
  code: string,
  message: string,
  pointer = "#",
  documentId?: string,
): ArazzoDiagnostic {
  return { code, severity: "error", message, pointer, documentId };
}

export function arazzoWarning(
  code: string,
  message: string,
  pointer = "#",
  documentId?: string,
): ArazzoDiagnostic {
  return { code, severity: "warning", message, pointer, documentId };
}

export function arazzoInfo(
  code: string,
  message: string,
  pointer = "#",
  documentId?: string,
): ArazzoDiagnostic {
  return { code, severity: "info", message, pointer, documentId };
}

export function hasErrors(diagnostics: readonly ArazzoDiagnostic[]) {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

