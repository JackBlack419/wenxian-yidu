/** The reflowed reading view has a DOM selection, separate from PDF ranges. */
interface Binding {
  doc: Document;
  dispose(): void;
}

const bindings = new WeakMap<object, Binding>();
const listeners = new Set<(reader: any, text: string) => void>();

function readerKey(reader: any): object | null {
  const internal = reader?._internalReader ?? reader;
  const raw = internal?.wrappedJSObject ?? internal;
  return raw && (typeof raw === "object" || typeof raw === "function") ? raw : null;
}

function selectedText(doc: Document): string {
  try {
    const root = doc.getElementById("sdt-content");
    const selection = doc.getSelection();
    // Do not translate toolbar labels or selections outside the article.
    if (!root || !selection?.anchorNode || !selection.focusNode ||
        !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return "";
    return selection.toString().trim();
  } catch {
    return ""; // The iframe can be destroyed while a selection event is queued.
  }
}

function emit(reader: any, text: string): void {
  for (const listener of [...listeners]) {
    try { listener(reader, text); } catch { /* One pane must not disable others. */ }
  }
}

/** null means PDF mode; an empty string means reflow mode with no selection. */
export function readReflowSelection(reader: any): string | null {
  const key = readerKey(reader);
  const binding = key && bindings.get(key);
  return binding ? selectedText(binding.doc) : null;
}

export function subscribeReflowSelection(listener: (reader: any, text: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function unbindReflowSelection(reader: any): void {
  const key = readerKey(reader);
  if (key) bindings.get(key)?.dispose();
}

/** Owned by the bilingual session; removed on exit, iframe unload or replacement. */
export function bindReflowSelection(reader: any, doc: Document): () => void {
  const key = readerKey(reader);
  if (!key) return () => {};
  bindings.get(key)?.dispose();
  let disposed = false;
  const changed = () => {
    if (!disposed) emit(reader, selectedText(doc));
  };
  const binding: Binding = { doc, dispose: () => {
    if (disposed) return;
    disposed = true;
    for (const type of ["selectionchange", "pointerup", "keyup"]) doc.removeEventListener(type, changed);
    doc.defaultView?.removeEventListener("unload", binding.dispose);
    if (bindings.get(key) === binding) {
      bindings.delete(key);
      emit(reader, "");
    }
  } };
  bindings.set(key, binding);
  for (const type of ["selectionchange", "pointerup", "keyup"]) doc.addEventListener(type, changed);
  doc.defaultView?.addEventListener("unload", binding.dispose);
  changed();
  return binding.dispose;
}
