// Test-only worker: exit after the execution intent transaction commits.
import { Store } from '../src/infrastructure/store.ts';
import { Service } from '../src/application/service.ts';
import { FakeYgl } from './fixtures.ts';
const store = await Store.open(process.argv[2]);
const service = new Service(store, new FakeYgl(store), async () => { process.exit(86); });
await service.advance(process.argv[3], Number(process.argv[4]), 'crash-key');
process.exitCode = 87;
