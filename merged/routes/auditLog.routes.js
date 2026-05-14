const express = require('express');
const router = express.Router();
const {
    getAuditLogs,
    getAuditLogById,
    getAuditStats,
    exportAuditLogs,
} = require('../controllers/auditLog.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

// All audit log routes: must be logged in + admin only
router.use(protect);
router.use(authorize('super_admin', 'business_admin'));

router.get('/',        getAuditLogs);
router.get('/stats',   getAuditStats);
router.get('/export',  exportAuditLogs);
router.get('/:id',     getAuditLogById);

module.exports = router;
