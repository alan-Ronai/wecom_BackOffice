exports.up = (pgm) => { pgm.sql('create extension if not exists pgcrypto'); pgm.sql('create extension if not exists vector'); pgm.sql('create extension if not exists pg_trgm'); };
exports.down = (pgm) => { pgm.sql('drop extension if exists pg_trgm'); pgm.sql('drop extension if exists vector'); };
