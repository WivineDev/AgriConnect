const express = require('express');
const authenticate = require('../middleware/authenticate');
const authorizeRoles = require('../middleware/authorizeRoles');
const adminUsers = require('../controllers/adminUsersController');

const router = express.Router();
router.use(authenticate, authorizeRoles('ADMIN'));
router.get('/', adminUsers.listUsers);
router.patch('/:userId/status', adminUsers.updateStatus);
router.delete('/:userId', adminUsers.deleteUser);

module.exports = router;
