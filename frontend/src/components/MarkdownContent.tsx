"use client";

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkBreaks from "remark-breaks";
import rehypeKatex from "rehype-katex";

interface MarkdownContentProps {
  children: string;
  style?: React.CSSProperties;
}

export function MarkdownContent({ children, style }: MarkdownContentProps) {
  return (
    <div style={style}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkBreaks]}
        rehypePlugins={[rehypeKatex]}
        components={{
          p: ({ children }) => <p style={{ margin: "0 0 0.7em" }}>{children}</p>,
          h1: ({ children }) => <h1 style={{ fontSize: "1.32em", lineHeight: 1.25, margin: "1em 0 0.5em", fontWeight: 750, letterSpacing: "-0.015em" }}>{children}</h1>,
          h2: ({ children }) => <h2 style={{ fontSize: "1.2em", lineHeight: 1.3, margin: "0.95em 0 0.45em", fontWeight: 750, letterSpacing: "-0.01em" }}>{children}</h2>,
          h3: ({ children }) => <h3 style={{ fontSize: "1.1em", lineHeight: 1.32, margin: "0.8em 0 0.35em", fontWeight: 700 }}>{children}</h3>,
          ul: ({ children }) => <ul style={{ margin: "0.35em 0 0.7em", paddingLeft: "1.2em" }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ margin: "0.35em 0 0.7em", paddingLeft: "1.2em" }}>{children}</ol>,
          li: ({ children }) => <li style={{ margin: "0.25em 0" }}>{children}</li>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
