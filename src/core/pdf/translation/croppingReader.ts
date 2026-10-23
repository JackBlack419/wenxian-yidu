const itemID = (reader: any) => reader?._itemID ?? reader?.itemID ?? reader?._attachmentId ?? reader?.attachmentID;

/** Reader.open can return an existing reader. A return value is not ownership. */
export async function acquireCroppingReader(manager: any, attachmentId: number) {
  const before = new Set<any>(manager?._readers || []);
  let reader = [...before].find(candidate => itemID(candidate) === attachmentId);
  if (reader) return { reader, openedNew: false };
  reader = await manager.open(attachmentId);
  const openedNew = !!reader && !before.has(reader);
  reader ??= manager?._readers?.find((candidate: any) => itemID(candidate) === attachmentId);
  return reader ? { reader, openedNew } : null;
}
