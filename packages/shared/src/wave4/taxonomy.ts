/** Resolves a document's worlds and the people to alert in a world. Implemented by W1 on `document_worlds` + `user_roles`. */
export interface TaxonomyResolver {
  /** World slugs, primary first. Empty when the document does not exist. */
  worldsOf(documentId: string): Promise<string[]>;
  /** Active users holding `permission` whose world scope is null or includes `world`. */
  usersWithPermissionInWorld(permission: string, world: string): Promise<string[]>;
}
