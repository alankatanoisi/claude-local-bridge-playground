'use strict';

const fs = require('fs');
const path = require('path');

class RunLedger {
  constructor(runDir) {
    this.runDir = runDir;
    this.eventsPath = path.join(runDir, 'events.jsonl');
    this.statePath = path.join(runDir, 'state.json');
    this.artifactDir = path.join(runDir, 'artifacts');
    this.seq = 0;
    fs.mkdirSync(this.artifactDir, { recursive: true });
    // R10: reopening an existing run (resume-synthesis) must CONTINUE the
    // sequence, never restart at 1 — appended corrections stay ordered after
    // the original events.
    if (fs.existsSync(this.eventsPath)) {
      for (const line of fs.readFileSync(this.eventsPath, 'utf8').split('\n')) {
        if (!line) continue;
        try {
          const event = JSON.parse(line);
          if (event.seq > this.seq) this.seq = event.seq;
        } catch {
          // a torn line does not block resume; seq continues from the last good one
        }
      }
    }
  }

  append(type, payload = {}) {
    const event = { seq: ++this.seq, at: new Date().toISOString(), type, payload };
    fs.appendFileSync(this.eventsPath, JSON.stringify(event) + '\n', { mode: 0o600 });
    return event;
  }

  writeArtifact(name, value) {
    const safeName = String(name).replace(/[^a-zA-Z0-9._-]/g, '_');
    const file = path.join(this.artifactDir, safeName + '.json');
    atomicWrite(file, value);
    return path.relative(this.runDir, file);
  }

  checkpoint(state) {
    atomicWrite(this.statePath, { ...state, lastSeq: this.seq, updatedAt: new Date().toISOString() });
  }
}

function atomicWrite(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temp, file);
}

module.exports = { RunLedger, atomicWrite };
