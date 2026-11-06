// Where a commenter's profile photo is served, from the "<id>?v=<version>"
// ref on each comment and reply. Kept apart from lib/feedback so the browser
// can use it without pulling in the database client.
export const photoPath = (token: string, ref: string) => `/api/review/${token}/avatar/${ref}`;
