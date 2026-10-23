const splitReaders = new Map<string, any>();
export function getSplitReader(tabID: string): any { return splitReaders.get(tabID); }
export function bindSplitReader(tabID: string, reader: any): () => void {
  splitReaders.set(tabID, reader);
  return () => { if (splitReaders.get(tabID) === reader) splitReaders.delete(tabID); };
}
