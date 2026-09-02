'use strict';

// ─── GET /api/floor — the plant's state, in one call ──────────────────────────
//
// Two endpoints, one answer each, both computed by src/plantTruth.js:
//
//   GET /api/floor/snapshot     the whole plant, or one department / site / app
//   GET /api/floor/departments  the same snapshot per department, in one query set
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
const { floorSnapshot, departmentSnapshots } = require('../plantTruth');

const router = express.Router();

// GET /api/floor/snapshot?department_id=&site_id=&app_id=
//
// An id belonging to another company narrows to an empty scope — every count 0,
// every rate null, `scope.valid: false` — rather than widening the answer or
// echoing a name from the other tenant back at the caller.
router.get('/snapshot', (req, res) => {
  res.json(floorSnapshot(req.companyId, {
    siteId: req.query.site_id,
    departmentId: req.query.department_id,
    appId: req.query.app_id,
    stationId: req.query.station_id,
    productTypeId: req.query.product_type_id,
  }));
});

// GET /api/floor/departments?site_id=
//
// The per-department strip every floor screen draws. A fixed number of queries
// whatever the department count — the version this replaces cost six per card.
router.get('/departments', (req, res) => {
  res.json(departmentSnapshots(req.companyId, { siteId: req.query.site_id }));
});

module.exports = router;
