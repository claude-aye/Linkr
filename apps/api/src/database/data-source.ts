import 'dotenv/config';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

// NOTE: TypeORM's CLI loader (loadDataSource) collects every export that is a
// DataSource instance and throws if it finds more than one. Exporting the same
// instance as both `default` and a named export counts as two, so we expose a
// single named export `AppDataSource` — usable by the CLI (-d flag) and by
// programmatic callers alike.
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [__dirname + '/../modules/**/*.entity.{ts,js}'],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  migrationsTableName: 'typeorm_migrations',
  namingStrategy: new SnakeNamingStrategy(),
  synchronize: false,
  logging: ['error', 'schema'],
});
