'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const fixtures = require('./golden-plans/inputs.json');
const { acceptedPlans } = require('./helpers/golden-plan-fixture');

for (const fixture of fixtures) {
  test(`R14a golden accepted descriptors: ${fixture.name}`, () => {
    // These snapshots are intentional plan contracts, not run trajectories.
    // Read committed expectations; normal tests never regenerate them.
    const expected = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden-plans', `${fixture.name}.json`), 'utf8'));
    assert.deepEqual(acceptedPlans(fixture), expected, `${fixture.name} accepted plan/recovery descriptors changed`);
  });
}
