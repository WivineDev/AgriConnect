const express = require('express');
const authenticate = require('../middleware/authenticate');
const authorizeRoles = require('../middleware/authorizeRoles');
const marketplace = require('../controllers/marketplaceController');

const router = express.Router();
router.use(authenticate, authorizeRoles('BUYER'));
router.get('/products', marketplace.listProducts);
router.get('/products/:productId', marketplace.getProduct);
router.post('/products/:productId/inquiries', marketplace.createInquiry);
router.get('/inquiries', marketplace.listInquiries);
router.get('/inquiries/:inquiryId', marketplace.getInquiry);

module.exports = router;
