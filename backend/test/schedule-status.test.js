'use strict';
// ─── A job without a scheduled window is not "decades overdue" ────────────────
// calcScheduleStatus read NULL scheduled_start/scheduled_end as the Unix epoch,
// so any work order released from the ERP import or the API with only a due
// date reported overdue since 1970. Pure-function suite: no server, no port.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(os.tmpdir(), `mes-schedule-status-${process.pid}.db`);
process.env.SEED_DEMO_DATA = 'false';
const { calcScheduleStatus } = require('../src/routes/workorders');

const day = ms => new Date(Date.now() + ms).toISOString();
const DAY = 86400000;

describe('calcScheduleStatus without a scheduled window', () => {
  it('never reads a missing date as the epoch', () => {
    assert.equal(calcScheduleStatus({ status: 'pending', quantity: 50, quantity_completed: 0, scheduled_start: null, scheduled_end: null, due_date: null, released_at: day(-DAY) }), 'not_started');
    assert.equal(calcScheduleStatus({ status: 'in_progress', quantity: 50, quantity_completed: 12, scheduled_start: null, scheduled_end: null, due_date: null, released_at: day(-DAY) }), 'on_track');
  });
  it('uses the due date as the end of the window when that is all it has', () => {
    const future = new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10);
    const past = new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10);
    assert.equal(calcScheduleStatus({ status: 'in_progress', quantity: 50, quantity_completed: 12, scheduled_start: null, scheduled_end: null, due_date: future, released_at: day(-DAY) }), 'on_track');
    assert.equal(calcScheduleStatus({ status: 'in_progress', quantity: 50, quantity_completed: 12, scheduled_start: null, scheduled_end: null, due_date: past, released_at: day(-5 * DAY) }), 'overdue');
  });
  it('treats an unreadable date like a missing one', () => {
    assert.equal(calcScheduleStatus({ status: 'pending', quantity: 5, quantity_completed: 0, scheduled_start: 'garbage', scheduled_end: 'garbage', due_date: null, created_at: day(-DAY) }), 'not_started');
  });
  it('keeps the real window when both dates are set', () => {
    assert.equal(calcScheduleStatus({ status: 'in_progress', quantity: 10, quantity_completed: 0, scheduled_start: day(-3 * DAY), scheduled_end: day(-DAY) }), 'overdue');
    assert.equal(calcScheduleStatus({ status: 'pending', quantity: 10, quantity_completed: 0, scheduled_start: day(DAY), scheduled_end: day(3 * DAY) }), 'not_started');
  });
});
