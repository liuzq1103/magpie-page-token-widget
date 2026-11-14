// The harness of the tests has to be dependable: a gateway that lands on a
// port the fetch refuses makes a test fail for a reason that has nothing to
// do with the code it wants to test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startGateway, BAD_PORTS } from './helpers.mjs';

test('the gateway of the tests always listens on a port that fetch can talk to', async () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const gateway = await startGateway({ '/hello': { ok: true } });
    try {
      const port = Number(new URL(gateway.url).port);
      assert.equal(BAD_PORTS.has(port), false, `the gateway listens on ${port}, a port that fetch refuses`);
      // The fetch has to reach it: a bad port answers with "fetch failed".
      const answer = await fetch(`${gateway.url}/hello`);
      assert.equal(answer.status, 200);
      assert.deepEqual(await answer.json(), { ok: true });
    } finally {
      await gateway.close();
    }
  }
});
