"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type DragEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AsciiBackdrop } from "@/components/AsciiBackdrop";
import { LogoMark } from "@/components/LogoMark";
import { LAST_GRAPH_ID_KEY, deleteSavedGraph, fetchUsage, getOrCreateAnonymousUserId, lastKnownUsageSegments, listSavedGraphs } from "@/lib/api";
import type { SavedGraphListItem } from "@/lib/types";
import { BOARD_COLUMNS, UNSORTED, categoryColumns, useWorkspaces, type CategoryLook } from "@/lib/workspaces";
import { CreditsMeter } from "@/components/CreditsMeter";
import { CategoryIcon, CategoryPicker, colorValue } from "./CategoryStyle";
import styles from "./WorkspacesView.module.css";

type Column = { id: string; name: string; graphs: SavedGraphListItem[]; look?: CategoryLook; board: number };
type DropTarget = { column: string; before: string | null };
/** A drop target meaning "where it already is". */
const SELF_DROP = "__self__";

const PAGE = 50;

// One grid for every lane: 3 equal columns, 2 on tablets, 1 on phones.
const BREAKPOINTS = ["(max-width: 640px)", "(max-width: 960px)"];
function subscribeColumns(callback: () => void) {
  const lists = BREAKPOINTS.map(query => window.matchMedia(query));
  lists.forEach(list => list.addEventListener("change", callback));
  return () => lists.forEach(list => list.removeEventListener("change", callback));
}
const columnCount = () => (window.matchMedia(BREAKPOINTS[0]).matches ? 1 : window.matchMedia(BREAKPOINTS[1]).matches ? 2 : 3);
function useColumnCount() { return useSyncExternalStore(subscribeColumns, columnCount, () => 3); }
const titleOf = (graph: SavedGraphListItem) => graph.metadata.title || graph.query;

function formatDate(value: string) {
  const date = new Date(value);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" });
}

// ---- mini graph preview: an abstract lineage drawn from the canvas id and node count ----
function hash(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function seeded(seed: number) { let s = seed; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

function GraphPreview({ id, count }: { id: string; count: number }) {
  const { nodes, edges } = useMemo(() => {
    // Papers sit in time columns (older on the left), 1 to 3 per column, each citing into the column before it.
    const rand = seeded(hash(id));
    const total = Math.min(Math.max(count, 5), 15);
    const layers: { x: number; y: number; r: number }[][] = [];
    let placed = 0;
    while (placed < total) {
      const size = Math.min(total - placed, 1 + Math.floor(rand() * 3));
      layers.push(Array.from({ length: size }, (_, k) => ({ x: 0, y: size === 1 ? 18 + rand() * 48 : 10 + ((k + 0.5) / size) * 64 + (rand() - 0.5) * 10, r: 1.8 + rand() * 1.4 })));
      placed += size;
    }
    const nodes = layers.flatMap((layer, col) => layer.map(node => ({ ...node, x: 18 + (col / Math.max(layers.length - 1, 1)) * 264 + (rand() - 0.5) * 8 })));
    const edges: [number, number][] = [];
    let start = 0;
    layers.forEach((layer, col) => {
      if (col > 0) {
        const prev = layers[col - 1].length, prevStart = start - prev;
        layer.forEach((_, k) => {
          const a = prevStart + Math.floor(rand() * prev);
          edges.push([a, start + k]);
          if (prev > 1 && rand() > 0.5) { const b = prevStart + Math.floor(rand() * prev); if (b !== a) edges.push([b, start + k]); }
        });
      }
      start += layer.length;
    });
    return { nodes, edges };
  }, [id, count]);
  const seed = nodes[nodes.length - 1];
  return <svg className={styles.graph} viewBox="0 0 300 84" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    {edges.map(([a, b]) => <line key={`${a}-${b}`} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y} />)}
    {nodes.map((node, index) => <circle key={index} cx={node.x} cy={node.y} r={node.r} />)}
    <circle className={styles.graphSeed} cx={seed.x} cy={seed.y} r="6" />
  </svg>;
}

// ---- icons ----
const Icon = ({ children, size = 14 }: { children: ReactNode; size?: number }) =>
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
const InboxIcon = () => <Icon><path d="M2 9.5h3.2l.8 1.6h4l.8-1.6H14" /><path d="M3.4 3h9.2l1.4 6.5V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9.5z" /></Icon>;
const TrashIcon = () => <Icon><path d="M2.5 4h11M6 1.75h4M5 4v8.25c0 .55.45 1 1 1h4c.55 0 1-.45 1-1V4" /></Icon>;
const SearchIcon = () => <Icon><circle cx="7" cy="7" r="4.25" /><path d="m10.2 10.2 3.3 3.3" /></Icon>;
const PlusIcon = () => <Icon><path d="M8 3v10M3 8h10" /></Icon>;
const ChevronIcon = () => <Icon size={12}><path d="m4 6 4 4 4-4" /></Icon>;
const CloseIcon = () => <Icon><path d="m4 4 8 8M12 4l-8 8" /></Icon>;
const DropIcon = () => <Icon size={13}><path d="M8 2.5v8M4.8 7.6 8 10.8l3.2-3.2M3 13.5h10" /></Icon>;

export function WorkspacesView() {
  const router = useRouter();
  const workspaces = useWorkspaces();
  const [credits, setCredits] = useState(lastKnownUsageSegments);
  useEffect(() => {
    let active = true;
    fetchUsage().then((data) => { if (active) setCredits(data.segments); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const [graphs, setGraphs] = useState<SavedGraphListItem[] | null>(null);
  const [error, setError] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  // A category being dragged by its header, and where it would land: a board column, above `before` or at the bottom.
  const [movingCategory, setMovingCategory] = useState<string | null>(null);
  const [categoryTarget, setCategoryTarget] = useState<{ board: number; before: string | null } | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const [listComplete, setListComplete] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftLook, setDraftLook] = useState<CategoryLook>({});
  const [picking, setPicking] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const cols = useColumnCount();
  const closePicker = useCallback(() => setPicking(null), []);
  const pruned = useRef(false);
  const search = useRef<HTMLInputElement>(null);
  const draftLane = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const id = getOrCreateAnonymousUserId();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- The anonymous id only exists in the browser.
    setUserId(id);
    let cancelled = false;
    (async () => {
      const all: SavedGraphListItem[] = [];
      let offset = 0;
      let complete = false;
      for (let page = 0; page < 40; page++) {
        const result = await listSavedGraphs(id, { limit: PAGE, offset });
        all.push(...result.items);
        if (!result.hasMore || result.nextOffset == null) { complete = true; break; }
        offset = result.nextOffset;
      }
      if (!cancelled) { setGraphs(all); setListComplete(complete); }
    })().catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Couldn’t load your canvases."); });
    return () => { cancelled = true; };
  }, []);

  // Once every canvas is known, forget categorised ids that were deleted elsewhere.
  useEffect(() => {
    // A cut-off list would make unlisted canvases look deleted.
    if (!graphs || !listComplete || pruned.current) return;
    pruned.current = true;
    workspaces.prune(new Set(graphs.map(graph => graph.id)));
  }, [graphs, listComplete, workspaces]);

  useEffect(() => { if (adding) draftLane.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [adding]);

  // "/" jumps to search and "n" starts a new category, unless you're already typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const el = event.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (event.key === "/") { event.preventDefault(); search.current?.focus(); }
      else if (event.key.toLowerCase() === "n") { event.preventDefault(); setAdding(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const needle = query.trim().toLowerCase();
  const columns = useMemo<Column[]>(() => {
    const byId = new Map((graphs ?? []).map(graph => [graph.id, graph]));
    const filed = new Set<string>();
    const shown = (graph: SavedGraphListItem) => !needle || titleOf(graph).toLowerCase().includes(needle);
    const boardOf = categoryColumns(workspaces.categories);
    const categories = [...workspaces.categories].reverse().map(category => ({
      id: category.id,
      board: boardOf.get(category.id) ?? 0,
      name: category.name,
      look: { icon: category.icon, color: category.color },
      graphs: category.graphIds.flatMap(id => { const graph = byId.get(id); if (!graph || filed.has(id)) return []; filed.add(id); return shown(graph) ? [graph] : []; }),
    }));
    return [{ id: UNSORTED, name: "Unsorted", board: 0, graphs: (graphs ?? []).filter(graph => !filed.has(graph.id) && shown(graph)) }, ...categories];
  }, [graphs, workspaces.categories, needle]);

  // Each category sits in its own board column, newest at the top, with Unsorted heading the first. With fewer
  // columns on screen, board columns fold together. A new category opens at the top of the emptiest column.
  const stacks = Array.from({ length: cols }, (_, k) => columns.filter(column => Math.min(column.board, BOARD_COLUMNS - 1) % cols === k));
  const draftBoard = stacks.reduce((best, stack, k) => stack.length < stacks[best].length ? k : best, 0);

  const open = (graph: SavedGraphListItem) => {
    try { window.localStorage.setItem(LAST_GRAPH_ID_KEY, graph.id); } catch { /* Restricted storage: the canvas just won’t reopen automatically. */ }
    router.push("/");
  };

  const remove = async (graph: SavedGraphListItem) => {
    if (!userId || busy) return;
    setBusy(graph.id);
    try {
      await deleteSavedGraph(graph.id, userId);
      setGraphs(current => current && current.filter(item => item.id !== graph.id));
      workspaces.move(graph.id, UNSORTED);
      if (window.localStorage.getItem(LAST_GRAPH_ID_KEY) === graph.id) window.localStorage.removeItem(LAST_GRAPH_ID_KEY);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn’t delete that canvas.");
    } finally { setBusy(null); setConfirming(null); }
  };

  const submitCategory = () => {
    if (workspaces.create(draft, draftLook, draftBoard)) { setDraft(""); setDraftLook({}); setPicking(null); setAdding(false); }
  };

  const endCategoryMove = () => { setMovingCategory(null); setCategoryTarget(null); };

  // Moving a category: the board column under the pointer takes it, above the first category whose middle is
  // below the pointer, or at the bottom. Unsorted always stays at the top of the first column.
  const categoryDragOver = (event: DragEvent<HTMLDivElement>, board: number) => {
    if (!movingCategory) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const sections = [...event.currentTarget.querySelectorAll<HTMLElement>(":scope > section[data-category]")];
    const below = sections.find(section => {
      const box = section.getBoundingClientRect();
      return event.clientY < box.top + box.height / 2;
    });
    const before = below?.dataset.category ?? null;
    setCategoryTarget(current => current && current.board === board && current.before === before ? current : { board, before });
  };

  const categoryDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!movingCategory) return;
    event.preventDefault();
    // Dropping right above or below itself in its own column leaves it where it is.
    if (categoryTarget && categoryTarget.before !== movingCategory) workspaces.place(movingCategory, categoryTarget.board, categoryTarget.before);
    endCategoryMove();
  };

  const dragOver = (event: DragEvent, column: Column, index: number | null) => {
    if (!dragging) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    let before: string | null = null;
    if (index !== null) {
      const box = event.currentTarget.getBoundingClientRect();
      const upper = event.clientY < box.top + box.height / 2;
      before = column.graphs[upper ? index : index + 1]?.id ?? null;
    }
    // Over itself the card stays where it is. Search can hide its neighbours, so no anchor is safe: drop is a no-op.
    if (index !== null && column.graphs[index]?.id === dragging) before = SELF_DROP;
    else if (before === dragging) before = SELF_DROP;
    setTarget(current => current && current.column === column.id && current.before === before ? current : { column: column.id, before });
  };

  const drop = (event: DragEvent, column: Column) => {
    if (movingCategory) return;
    event.preventDefault();
    const id = dragging ?? event.dataTransfer.getData("text/plain");
    if (id && !(target?.column === column.id && target.before === SELF_DROP)) {
      workspaces.move(id, column.id, target?.column === column.id ? target.before : null);
    }
    setDragging(null);
    setTarget(null);
  };

  const total = graphs?.length ?? 0;
  const categoryCount = workspaces.categories.length;

  // The tile is a button for categories (it opens the icon and colour picker) and a plain inbox icon for Unsorted.
  const tile = (key: string, look: CategoryLook, onChange: (next: CategoryLook) => void) => {
    const tint = colorValue(look.color);
    return <span className={styles.tileWrap}>
      <button type="button" className={styles.columnIcon} data-tinted={tint ? "" : undefined} style={{ "--tile": tint } as CSSProperties}
        aria-label="Change icon and colour" aria-haspopup="dialog" aria-expanded={picking === key} onClick={() => setPicking(current => current === key ? null : key)}>
        <CategoryIcon icon={look.icon} />
      </button>
      {picking === key && <CategoryPicker look={look} onChange={onChange} onClose={closePicker} />}
    </span>;
  };

  const renderColumn = (column: Column) => {
            const over = target?.column === column.id;
            const movable = column.id !== UNSORTED && renaming !== column.id;
            return <section key={column.id} data-category={column.id === UNSORTED ? undefined : column.id} className={`${styles.column} ${over ? styles.columnOver : ""} ${movingCategory === column.id ? styles.columnMoving : ""} ${picking === column.id ? styles.pickerOpen : ""}`} aria-label={column.name}
              onDragOver={event => dragOver(event, column, null)} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTarget(current => current?.column === column.id ? null : current); }} onDrop={event => drop(event, column)}>
              <header className={styles.columnHeader} data-movable={movable || undefined} draggable={movable}
                title={movable ? "Drag to move this category to another column" : undefined}
                onDragStart={event => {
                  if (!movable || event.target !== event.currentTarget) return;
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("application/x-sediment-category", column.id);
                  setMovingCategory(column.id);
                  setPicking(null);
                }}
                onDragEnd={endCategoryMove}>
                {column.id === UNSORTED ? <span className={styles.columnIcon}><InboxIcon /></span> : tile(column.id, column.look ?? {}, next => workspaces.restyle(column.id, next))}
                {renaming === column.id
                  ? <input className={styles.rename} autoFocus defaultValue={column.name} maxLength={60} aria-label="Category name"
                    onBlur={event => { workspaces.rename(column.id, event.target.value); setRenaming(null); }}
                    onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setRenaming(null); }} />
                  : column.id === UNSORTED
                    ? <h2>{column.name}</h2>
                    : <h2><button type="button" className={styles.nameButton} title="Rename category" onClick={() => setRenaming(column.id)}>{column.name}</button></h2>}
                {column.id !== UNSORTED && (confirming === column.id
                  ? <button type="button" className={styles.danger} onClick={() => { workspaces.remove(column.id); setConfirming(null); }} onBlur={() => setConfirming(null)} autoFocus>Delete category?</button>
                  : <button type="button" className={`${styles.iconButton} ${styles.reveal}`} aria-label={`Delete category ${column.name}`} title="Delete category (canvases move back to Unsorted)" onClick={() => setConfirming(column.id)}><TrashIcon /></button>)}
                <span className={styles.pill}>{column.graphs.length}</span>
              </header>
              <ul className={styles.list}>
                {column.graphs.map((graph, index) => <li key={graph.id}
                  className={`${styles.card} ${dragging === graph.id ? styles.cardDragging : ""} ${over && target?.before === graph.id ? styles.dropBefore : ""}`}
                  draggable onDragStart={event => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", graph.id); setDragging(graph.id); }}
                  onDragEnd={() => { setDragging(null); setTarget(null); }} onDragOver={event => dragOver(event, column, index)}>
                  <div className={styles.preview}><GraphPreview id={graph.id} count={graph.metadata.nodeCount} /></div>
                  <div className={styles.cardBody}>
                    <button type="button" className={styles.title} onClick={() => open(graph)}>{titleOf(graph)}</button>
                    {graph.metadata.description && <p className={styles.description} title={graph.metadata.description}>{graph.metadata.description}</p>}
                    <p className={styles.meta}>
                      <span>{graph.metadata.nodeCount} {graph.metadata.nodeCount === 1 ? "node" : "nodes"}</span>
                      <i aria-hidden="true">·</i>
                      <time dateTime={graph.updatedAt}>Updated {formatDate(graph.updatedAt)}</time>
                    </p>
                    <div className={styles.cardActions}>
                      <label className={styles.move}>
                        <select aria-label={`Move ${titleOf(graph)} to`} value={column.id} onChange={event => { workspaces.move(graph.id, event.target.value); event.currentTarget.blur(); }}>
                          <option value={UNSORTED}>Unsorted</option>
                          {workspaces.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
                        </select>
                        <ChevronIcon />
                      </label>
                      {confirming === graph.id
                        ? <button type="button" className={styles.danger} disabled={busy === graph.id} onClick={() => void remove(graph)} onBlur={() => setConfirming(null)} autoFocus>{busy === graph.id ? "Deleting…" : "Delete?"}</button>
                        : <button type="button" className={styles.iconButton} aria-label={`Delete ${titleOf(graph)}`} onClick={() => setConfirming(graph.id)}><TrashIcon /></button>}
                    </div>
                  </div>
                </li>)}
                {column.graphs.length === 0 && <li className={styles.placeholder}>
                  {needle ? "No matches" : column.id === UNSORTED ? "Everything is filed." : <><DropIcon />Drop canvases here</>}
                </li>}
                {over && target?.before === null && dragging && column.graphs.length > 0 && <li className={styles.dropEnd} aria-hidden="true" />}
              </ul>
            </section>;
          };

  const draftLaneNode = <form key="draft" ref={draftLane} className={`${styles.column} ${styles.draftColumn} ${picking === "draft" ? styles.pickerOpen : ""}`} aria-label="New category" onSubmit={event => { event.preventDefault(); submitCategory(); }}>
    <header className={styles.columnHeader}>
      {tile("draft", draftLook, setDraftLook)}
      <input className={styles.rename} autoFocus value={draft} maxLength={60} placeholder="Category name" aria-label="Category name" onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === "Escape") { setAdding(false); setDraft(""); setDraftLook({}); } }} />
      <button type="submit" className={styles.miniPrimary} disabled={!draft.trim()}>Create</button>
      <button type="button" className={styles.iconButton} aria-label="Cancel" onClick={() => { setAdding(false); setDraft(""); setDraftLook({}); setPicking(null); }}><CloseIcon /></button>
    </header>
    <ul className={styles.list}><li className={styles.placeholder}>Name it, then drag canvases in</li></ul>
  </form>;

  const laneStacks = stacks.map((stack, k) => {
    const lanes: { id: string; node: ReactNode }[] = stack.map(column => ({ id: column.id, node: renderColumn(column) }));
    if (adding && k === draftBoard) lanes.splice(k === 0 ? 1 : 0, 0, { id: "draft", node: draftLaneNode });
    // While a category is dragged, a line shows where it will land.
    if (movingCategory && categoryTarget?.board === k) {
      const at = categoryTarget.before ? lanes.findIndex(lane => lane.id === categoryTarget.before) : -1;
      lanes.splice(at < 0 ? lanes.length : at, 0, { id: "category-drop", node: <div key="category-drop" className={styles.laneDrop} aria-hidden="true" /> });
    }
    return lanes.map(lane => lane.node);
  });

  return <div className={`landing-shell ${styles.shell}`}>
    <div className={styles.backdrop}><AsciiBackdrop /></div>
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand}><LogoMark width="28" height="28" /><span>Sediment</span></Link>
        <div className="credit-meter-bar"><CreditsMeter credits={credits} expandable /></div>
        <span className={styles.here} aria-current="page">Workspaces</span>
      </header>

      <main className={styles.main}>
        <div className={styles.heading}>
          <div className={styles.headingText}>
            <h1>Workspaces</h1>
            <p>Group your canvases into categories. Drag a canvas into a category to file it, or drag a category by its name to another column.</p>
            {graphs !== null && <span className={styles.stats}>{total} {total === 1 ? "canvas" : "canvases"} · {categoryCount} {categoryCount === 1 ? "category" : "categories"}</span>}
          </div>
          <div className={styles.tools}>
            <label className={styles.search}>
              <SearchIcon />
              <input ref={search} value={query} placeholder="Search canvases" aria-label="Search canvases" onChange={event => setQuery(event.target.value)}
                onKeyDown={event => { if (event.key === "Escape") { setQuery(""); event.currentTarget.blur(); } }} />
              <kbd>/</kbd>
            </label>
            <button type="button" className={styles.primary} onClick={() => setAdding(true)}><PlusIcon />New category<kbd>N</kbd></button>
          </div>
        </div>

        {error && <p role="alert" className={styles.error}>{error}</p>}
        {graphs === null && !error && <p role="status" className={styles.status}>Loading your canvases…</p>}
        {graphs !== null && total === 0 && <div className={styles.empty}>
          <h2>No canvases yet</h2>
          <p>Trace a concept and Sediment keeps the canvas here, ready to file into a category.</p>
          <button type="button" className={styles.secondary} onClick={() => router.push("/")}>Start a trace</button>
        </div>}

        {graphs !== null && (total > 0 || categoryCount > 0 || adding) && <div className={styles.board} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {laneStacks.map((stack, k) => <div key={k} className={styles.laneStack} onDragOver={event => categoryDragOver(event, k)} onDrop={categoryDrop}>{stack}</div>)}
        </div>}
      </main>
    </div>
  </div>;
}
