const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const {
    getStats,
    getAllUsers,
    getUserById,
    updateUserRole,
    updateUserStatus,
    deleteUser,
    getPlans,
    createPlan,
    updatePlan,
    deletePlan,
    getAllSubscriptions,
    getAllPayments,
} = require('../controllers/superAdmin.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

// All routes: must be logged in + must be super_admin
router.use(protect);
router.use(authorize('super_admin'));

// ─── Dashboard ────────────────────────────────────────────────────────────────
router.get('/stats', getStats);

// ─── User Management ──────────────────────────────────────────────────────────
router.get('/users', getAllUsers);
router.get('/users/:id', getUserById);
router.put('/users/:id/role', [
    body('role').isIn(['super_admin', 'business_admin', 'marketing_manager', 'viewer', 'individual'])
        .withMessage('Invalid role'),
], updateUserRole);
router.put('/users/:id/status', [
    body('isActive').isBoolean().withMessage('isActive must be boolean'),
], updateUserStatus);
router.delete('/users/:id', deleteUser);

// ─── Plan Management ──────────────────────────────────────────────────────────
router.get('/plans', getPlans);
router.post('/plans', [
    body('name').trim().notEmpty().withMessage('Plan name required'),
    body('slug').trim().notEmpty().withMessage('Plan slug required'),
    body('monthlyPrice').isNumeric().withMessage('Monthly price required'),
    body('yearlyPrice').isNumeric().withMessage('Yearly price required'),
], createPlan);
router.put('/plans/:id', updatePlan);
router.delete('/plans/:id', deletePlan);

// ─── Subscriptions ────────────────────────────────────────────────────────────
router.get('/subscriptions', getAllSubscriptions);

// ─── Payments ─────────────────────────────────────────────────────────────────
router.get('/payments', getAllPayments);

module.exports = router;
