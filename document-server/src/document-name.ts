const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function assertDocumentName(value: string): void {
  if (!uuidPattern.test(value)) throw new Error("invalid-document-name")
}
