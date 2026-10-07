import { useRef, useState } from "react";
import type { FeedPaper } from "@/lib/feeds-api";
import styles from "./PaperStage.module.css";

export function mentionedPapers(text: string, papers: FeedPaper[]) {
  const mentions = [...text.matchAll(/(?:^|\s)@(all\b|"(?:\\.|[^"\\])*")/gi)];
  if (mentions.some(match => match[1].toLowerCase() === "all")) return papers;
  const titles = new Set(mentions.map(match => {
    try { return JSON.parse(match[1]) as string; } catch { return ""; }
  }));
  return papers.filter(paper => titles.has(paper.title));
}

export function PaperMentionInput({ value, onChange, papers }: { value: string; onChange: (value: string) => void; papers: FeedPaper[] }) {
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState<{ start: number; end: number; text: string } | null>(null);
  const [selected, setSelected] = useState(0);
  const options = query ? [{ id: "all", title: "All papers" }, ...papers].filter(paper => paper.title.toLowerCase().includes(query.text.toLowerCase()) || (paper.id === "all" && "all".startsWith(query.text.toLowerCase()))) : [];
  function inspect(text: string, caret: number) {
    const match = text.slice(0, caret).match(/(?:^|\s)@([^@"\n]*)$/);
    setQuery(match ? { start: caret - match[1].length - 1, end: caret, text: match[1] } : null);
    setSelected(0);
  }
  function choose(index: number) {
    if (!query || !options[index]) return;
    const paper = options[index];
    const token = paper.id === "all" ? "@all " : `@${JSON.stringify(paper.title)} `;
    onChange(value.slice(0, query.start) + token + value.slice(query.end));
    setQuery(null);
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(query.start + token.length, query.start + token.length); });
  }
  return <>
    <input ref={input} id="paper-question" role="combobox" aria-autocomplete="list" aria-expanded={!!query} aria-controls={query ? "paper-mentions" : undefined} aria-activedescendant={query && options[selected] ? `paper-mention-${selected}` : undefined} placeholder="Ask feeds agent · @all or @ a paper" aria-label="Ask feeds agent; use @all or mention papers" value={value}
      onChange={event => { onChange(event.target.value); inspect(event.target.value, event.target.selectionStart ?? event.target.value.length); }}
      onClick={event => inspect(value, event.currentTarget.selectionStart ?? value.length)} onBlur={() => setQuery(null)}
      onKeyDown={event => {
        if (!query) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setQuery(null); }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setSelected(index => options.length ? (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length : 0); }
        if (event.key === "Enter" && options.length) { event.preventDefault(); choose(selected); }
      }} />
    {query && <div id="paper-mentions" className={styles.mentionMenu} role="listbox" aria-label="Mention papers">
      {options.map((paper, index) => <button key={paper.id} id={`paper-mention-${index}`} type="button" role="option" aria-selected={index === selected} onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>{paper.id === "all" ? "@all — All marked papers" : paper.title}</button>)}
      {!options.length && <span>No matching papers</span>}
    </div>}
  </>;
}
