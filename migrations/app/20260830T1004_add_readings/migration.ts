#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/ec803ec1c97adbd0d7b84fdf8268853ead3d5e36e88330464c28c51d9eb7e7ad/contract';
import endContract from '../../snapshots/ec803ec1c97adbd0d7b84fdf8268853ead3d5e36e88330464c28c51d9eb7e7ad/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createTable({
        schema: 'public',
        table: 'readings',
        columns: [
          col('deviceId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('humidity', 'float8', { notNull: true, codecRef: { codecId: 'pg/float8@1' } }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('receivedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('temperature', 'float8', { notNull: true, codecRef: { codecId: 'pg/float8@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
