import {CopyButton} from "@/components/ui/CopyButton";

/**
 * A code listing with a mono caption bar and a copy control.
 *
 * There is no syntax highlighter: highlighting Solidity, TypeScript, JSON and
 * shell would mean shipping a tokeniser to the browser for text that is read
 * once, and the reference build's docs are legible without colour. The caption
 * carries the language instead, which is the part a reader actually needs.
 */

export type CodeBlockProps = {
  children: string;
  /** Shown in the caption bar: a language, a file path, or a request line. */
  label?: string;
  /** Hide the copy control for fragments that are not meant to be pasted. */
  copyable?: boolean;
};

export function CodeBlock({children, label, copyable = true}: CodeBlockProps) {
  const code = children.replace(/^\n+/, "").replace(/\s+$/, "");

  return (
    <div className="doc-code">
      {label || copyable ? (
        <div className="doc-code-head">
          <span className="mono-label">{label ?? "Code"}</span>
          {copyable ? <CopyButton value={code} label="Copy code" /> : null}
        </div>
      ) : null}
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}
