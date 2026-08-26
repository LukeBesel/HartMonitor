'use strict';
// ─── The demo's shift is honest at every minute of the day ───────────────────
// Three suites here were red for the first hours after UTC midnight and green
// by the afternoon, and the one nobody had found was this: the sandbox sized
// today's run count against a whole hour of shift while OEE divides today's
// output by the minutes the station has actually been open. Between 00:00 and
// 00:48 the two disagreed, the honest Performance ratio reached 426 %, and the
// public demo's front page showed the clamp — 100 %. A clamped ratio is a
// number nobody measured.
//
// A suite that is green when you run it and red at 03:00 is worse than no
// suite, so this one does not depend on when it runs at all: the arithmetic is
// a pure function of "how far into the day is it", and every one of the 1440
// answers is checked. It spawns no server and opens no port, so it also cannot
// be cancelled by a collision.
//
// Uses Node built-ins only (node:test). Run with: npm test

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { shiftShape, TARGET_PERF } = require('../src/sandbox');

// The demo app's own step takts, summed: 5 + 240 + 120. Read from the seed in
// production; pinned here so this file tests the arithmetic, not the app.
const IDEAL_CYCLE_S = 365;

/** Performance exactly as routes/oee.js computes it, but WITHOUT the clamp. */
function rawPerformance({ runs, windowMin }) {
  return (runs * IDEAL_CYCLE_S) / (windowMin * 60);
}

describe('the sandbox seeds a shift it can honestly measure', () => {
  it('never needs the Performance clamp, at any minute of the day', () => {
    for (let m = 0; m <= 1440; m++) {
      const shape = shiftShape(m, IDEAL_CYCLE_S);
      if (shape.runs === 0) continue;
      const perf = rawPerformance(shape);
      assert.ok(perf <= 1,
        `${m} minutes in: ${shape.runs} runs in a ${shape.windowMin}-minute window is ` +
        `${Math.round(perf * 100)}% performance, which the screen can only show by clamping it`);
    }
  });

  it('lands on the target pace once there is room for a single run', () => {
    for (let m = 0; m <= 1440; m++) {
      const shape = shiftShape(m, IDEAL_CYCLE_S);
      if (shape.runs === 0) continue;
      const perf = rawPerformance(shape);
      // Whole runs in a whole-minute window cannot hit 79 % exactly, and the
      // window is rounded up so the pace can only fall SHORT of the target,
      // never overshoot it. One run in an eight-minute window is the coarsest
      // case and lands at 76 %.
      assert.ok(perf > TARGET_PERF - 0.04 && perf <= TARGET_PERF,
        `${m} minutes in: performance ${Math.round(perf * 100)}% is not the seeded pace`);
    }
  });

  it('never opens the station\'s day before the day began', () => {
    // The window is how far back the station's first event is planted. Reach
    // past midnight and those runs stop counting toward today at all, and the
    // demo reports a station that has done nothing.
    for (let m = 1; m <= 1440; m++) {
      const shape = shiftShape(m, IDEAL_CYCLE_S);
      assert.ok(shape.windowMin <= m,
        `${m} minutes in: a ${shape.windowMin}-minute window reaches into yesterday`);
    }
  });

  it('never claims a longer shift than the day so far, or more than eight hours', () => {
    for (let m = 0; m <= 1440; m++) {
      const shape = shiftShape(m, IDEAL_CYCLE_S);
      assert.ok(shape.plannedHours >= 1 && shape.plannedHours <= 8, `${m}: ${shape.plannedHours}h`);
      // Rounded up, so the planned day never clamps the window below itself.
      assert.ok(shape.plannedHours * 60 >= shape.windowMin,
        `${m} minutes in: a ${shape.plannedHours}h plan cannot hold a ${shape.windowMin}-minute window`);
    }
  });

  it('seeds nothing rather than something unmeasurable in the first minutes', () => {
    // Below one run's worth of day there is no honest shift to show. The seed
    // puts down no runs and the station reports an unmeasured OEE, which is the
    // truth. The alternative — one unit divided by a two-minute day — is the
    // fabricated number this file exists to prevent.
    const roomForOne = Math.ceil(IDEAL_CYCLE_S / TARGET_PERF / 60);
    assert.equal(shiftShape(0, IDEAL_CYCLE_S).runs, 0);
    assert.equal(shiftShape(roomForOne - 2, IDEAL_CYCLE_S).runs, 0,
      'just short of one run at the target pace seeds none');
    assert.ok(shiftShape(roomForOne, IDEAL_CYCLE_S).runs >= 1,
      'as soon as there is room for one, one appears');
  });

  it('grows the shift monotonically as the day goes on', () => {
    // A later hour can never show LESS of a day than an earlier one — a demo
    // whose output went backwards over lunch would be its own bug report.
    let prev = shiftShape(0, IDEAL_CYCLE_S);
    for (let m = 1; m <= 1440; m++) {
      const shape = shiftShape(m, IDEAL_CYCLE_S);
      assert.ok(shape.runs >= prev.runs, `runs fell between ${m - 1} and ${m} minutes`);
      prev = shape;
    }
    assert.ok(prev.runs >= 60, 'a full eight-hour shift is around sixty units, not a handful');
  });

  it('is safe on an app whose steps declare no takt at all', () => {
    // IDEAL_CYCLE_S is summed from the app's own step takts, so an app with none
    // makes it zero. Dividing by that would seed Infinity runs.
    const shape = shiftShape(600, 0);
    assert.equal(shape.runs, 0);
    assert.ok(Number.isFinite(shape.windowMin) && shape.windowMin >= 1);
  });
});
