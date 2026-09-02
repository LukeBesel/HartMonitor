'use strict';

// ─── GET /api/floor — the plant's state, in one call ──────────────────────────
//
// Five endpoints, one answer each, every one of them computed by
// src/plantTruth.js:
//
//   GET /api/floor/snapshot     the whole plant, or one department / site / app
//   GET /api/floor/departments  the same snapshot per department, in one query set
//   GET /api/floor/dispatch     what to run next here, in the order to run it
//   GET /api/floor/wip          "where is WO-1042?", answered in one sentence
//   GET /api/floor/wip-summary  running / queued / good / scrap today, per department
//
// The last three are the keystone's data finally reaching a screen: releasing a
// work order has written ordered operations since wave 3 and nothing read them,
// so the question a supervisor asks twenty times a day had no home.
//
// Every number arrives with the sample behind it and the plant date it was
// measured on, and anything nobody measured is null with a reason rather than a
// 0 that reads as a measurement.
//
// NO PLAN GATE. Knowing what the floor is doing right now is the product, not an
// upsell: a Free account that cannot see its own day has not been given a
// cheaper version of this, it has been given a broken one. Mounted with the same
// auth as /api/analytics, and read-only, so there is no write role to gate.

const express = require('express');
const {
  plantContext, floorSnapshot, departmentSnapshots,
  dispatchQueue, wipSearch, wipSummary,
} = require('../plantTruth');

const router = express.Router();

// GET /api/floor/snapshot?department_id=&site_id=&app_id=&operator_user_id=&operator_name=
//
// An id belonging to another company narrows to an empty scope — every count 0,
// every rate null, `scope.valid: false` — rather than widening the answer or
// echoing a name from the other tenant back at the caller.
//
// `operator_user_id` / `operator_name` add ONE figure — finished_today_for_operator
// — measured on the same plant day as everything else on the payload. It is not
// a scope: the plant's numbers do not change because an operator asked.
router.get('/snapshot', (req, res) => {
  res.json(floorSnapshot(plantContext(req.companyId), {
    siteId: req.query.site_id,
    departmentId: req.query.department_id,
    appId: req.query.app_id,
    stationId: req.query.station_id,
    productTypeId: req.query.product_type_id,
    operator: {
      userId: req.query.operator_user_id,
      name: req.query.operator_name,
    },
  }));
});

// GET /api/floor/departments?site_id=
//
// The per-department strip every floor screen draws. A fixed number of queries
// whatever the department count — the version this replaces cost six per card.
router.get('/departments', (req, res) => {
  res.json(departmentSnapshots(plantContext(req.companyId), { siteId: req.query.site_id }));
});

// GET /api/floor/dispatch?department_id=&station_id=&site_id=&app_id=
//
// The queue: every READY or RUNNING operation in scope, in priority → due date
// (nulls last) → sequence order, plus the published apps that need no work
// order at all — the ones the Operator Portal could not list, because it listed
// work orders and one of the plant's real jobs ('Final QC Inspection') is not
// attached to any.
router.get('/dispatch', (req, res) => {
  res.json(dispatchQueue(plantContext(req.companyId), {
    siteId: req.query.site_id,
    departmentId: req.query.department_id,
    stationId: req.query.station_id,
    appId: req.query.app_id,
  }));
});

// GET /api/floor/wip?q=WO-1042
//
// One sentence: which operation a job is standing on, how far through it is,
// and — for a job nobody released — that it was never released and what status
// it is sitting at instead. A part number that matches several open jobs
// answers with the list rather than picking one.
router.get('/wip', (req, res) => {
  res.json(wipSearch(plantContext(req.companyId), req.query.q));
});

// GET /api/floor/wip-summary?department_id=&site_id=
//
// Work in progress by operation, per department: how much is running, how much
// is waiting, and today's good and scrap where anybody counted them. The counts
// are null with a reason until the completions rows carry them — a plant that
// has never recorded scrap has not made zero scrap.
router.get('/wip-summary', (req, res) => {
  res.json(wipSummary(plantContext(req.companyId), {
    siteId: req.query.site_id,
    departmentId: req.query.department_id,
  }));
});

module.exports = router;
