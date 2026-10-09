import { DOMParser } from "@xmldom/xmldom";
import xpath from "xpath";
import type { SelectedValue } from "xpath";
import type { SelectorParseResult } from "./selectors";

const MAX_XPATH_RESULTS = 1_000;
type XPathSelection = SelectedValue | Node[];

interface XPathNode {
 nodeType?: number;
 nodeValue?: string | null;
 textContent?: string | null;
}

function parseXmlDocument(context: unknown): SelectorParseResult<Node> {
 if (typeof context !== "string" || context.trim().length === 0) {
   return {
     error:
       "XPath selectors require a non-empty XML string context, such as $response.body for an XML response.",
   };
 }

  let document: Node | undefined;
  const parserErrors: string[] = [];
 try {
    document = new DOMParser({
      onError: (_level, message) => {
        parserErrors.push(message);
      },
    }).parseFromString(context, "text/xml") as unknown as Node;
 } catch (error) {
   return {
     error: `Unable to parse the XML context: ${error instanceof Error ? error.message : String(error)}`,
   };
 }

 const documentElement = (document as unknown as { documentElement?: Element | null }).documentElement;
 if (!documentElement) {
    return {
      error: `The XML context is not well-formed: ${parserErrors[0] ?? "no document element was found"}`,
    };
 }
 return { value: document };
}

function nodeValue(node: XPathNode) {
 if (typeof node.nodeValue === "string") return node.nodeValue;
 if (typeof node.textContent === "string") return node.textContent;
 return "";
}

function select(query: string, document: Node): SelectorParseResult<XPathSelection> {
 try {
   const selected = xpath.select(query, document);
    if (Array.isArray(selected) && selected.length > MAX_XPATH_RESULTS) {
     return { error: `XPath evaluation exceeded ${MAX_XPATH_RESULTS} results.` };
   }
   return { value: selected };
 } catch (error) {
   return {
     error: `XPath parse error: ${error instanceof Error ? error.message : String(error)}`,
   };
 }
}

/** Validates XPath syntax without evaluating against real data. */
export function parseXPathQuery(query: string): SelectorParseResult<true> {
 if (query.trim().length === 0) {
   return { error: "An XPath query cannot be empty." };
 }
 const document = parseXmlDocument("<root/>");
 if (document.error || !document.value) return { error: document.error };
 const parsed = select(query, document.value);
 return parsed.error ? { error: parsed.error } : { value: true };
}

function selectedValues(selected: XPathSelection): unknown[] {
  if (Array.isArray(selected)) return selected.map(node => nodeValue(node));
 return [selected];
}

function truthiness(selected: XPathSelection): boolean {
  if (Array.isArray(selected)) return selected.length > 0;
 if (typeof selected === "boolean") return selected;
 if (typeof selected === "number") return !Number.isNaN(selected) && selected !== 0;
 if (typeof selected === "string") return selected.length > 0;
 return false;
}

/**
* Evaluates an XPath 1.0 query against an XML string context. Node-set
* results are returned as string-values; primitive results are returned as
* single-element arrays.
*/
export function evaluateXPath(context: unknown, query: string): SelectorParseResult<unknown[]> {
 const document = parseXmlDocument(context);
 if (document.error || !document.value) return { error: document.error };
 const result = select(query, document.value);
 if (result.error || result.value === undefined) return { error: result.error };
 return { value: selectedValues(result.value) };
}

/**
* Evaluates an XPath 1.0 expression with XPath truthiness: node-sets are true
* when non-empty, numbers when non-zero, and strings when non-empty.
*/
export function evaluateXPathCriterion(context: unknown, query: string): SelectorParseResult<boolean> {
 const document = parseXmlDocument(context);
 if (document.error || !document.value) return { error: document.error };
 const result = select(query, document.value);
 if (result.error || result.value === undefined) return { error: result.error };
 return { value: truthiness(result.value) };
}
