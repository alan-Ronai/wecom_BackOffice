exports.up = (pgm) => {
  // `schedule` becomes nullable: `null` is "ללא תזמון" — the connector runs on demand
  // only, and the scheduler unregisters its pg-boss cron. The column keeps its default
  // for connectors created without naming a schedule at all.
  pgm.alterColumn('connectors', 'schedule', { notNull: false });
};
exports.down = (pgm) => {
  pgm.sql("update connectors set schedule = '*/15 * * * *' where schedule is null");
  pgm.alterColumn('connectors', 'schedule', { notNull: true });
};
