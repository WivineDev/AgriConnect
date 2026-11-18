const express = require('express');
const { health, readiness } = require('../controllers/healthController');

const router = express.Router();
router.get('/health', health);
router.get('/ready', readiness);

module.exports = router;
