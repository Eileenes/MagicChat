export class ContributorTracker {
  private readonly pending = new Map<string, Set<string>>()

  record(documentName: string, userId: string | undefined): void {
    if (!userId) return
    const contributors = this.pending.get(documentName) ?? new Set<string>()
    contributors.add(userId)
    this.pending.set(documentName, contributors)
  }

  take(documentName: string, fallbackUserId?: string): string[] {
    const contributors = this.pending.get(documentName) ?? new Set<string>()
    if (fallbackUserId) contributors.add(fallbackUserId)
    this.pending.delete(documentName)
    return Array.from(contributors)
  }
}
