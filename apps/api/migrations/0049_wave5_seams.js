/**
 * Wave 5 (V6): the foreign keys V2's 0047 could not declare.
 *
 * `learning_audiences.item_id` and `learning_assignments.item_id` point at V1's `learning_items`
 * (0046), which was authored in a different worktree — so 0047 shipped them as plain uuids and
 * left the reference to the integration lane. With both migrations on one branch the constraint
 * can finally be stated: deleting an item takes its audiences and its assignments with it, which
 * is what `DELETE /learning/items/:id`'s soft delete already implies and what kept the tracking
 * tables from accumulating rows pointing at nothing.
 */
exports.up = (pgm) => {
  pgm.addConstraint('learning_audiences', 'learning_audiences_item_id_fkey', {
    foreignKeys: { columns: 'item_id', references: 'learning_items', onDelete: 'CASCADE' },
  });
  pgm.addConstraint('learning_assignments', 'learning_assignments_item_id_fkey', {
    foreignKeys: { columns: 'item_id', references: 'learning_items', onDelete: 'CASCADE' },
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint('learning_assignments', 'learning_assignments_item_id_fkey');
  pgm.dropConstraint('learning_audiences', 'learning_audiences_item_id_fkey');
};
