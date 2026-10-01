/** Fetch every page or fail. Returning partial inventory would hide duplicates. */
export async function readAllPages<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>, pageSize = 500): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await fetchPage(offset, offset + pageSize - 1)
    if (error) throw error
    rows.push(...(data || []))
    if ((data?.length || 0) < pageSize) return rows
  }
}
