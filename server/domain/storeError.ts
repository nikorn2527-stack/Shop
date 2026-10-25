/** Business-rule error carrying a Thai, user-facing message. tRPC maps it to BAD_REQUEST. */
export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreError";
  }
}
