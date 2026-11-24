export class ArchiveError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_empty"
      | "not_an_archive"
      | "unsupported_format"
      | "locked"
      | "stale_lock"
      | "missing",
  ) {
    super(message);
    this.name = "ArchiveError";
  }
}
