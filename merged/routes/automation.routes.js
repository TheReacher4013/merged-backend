const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const {
    getAutomations, getAutomation, createAutomation, updateAutomation,
    activateAutomation, pauseAutomation, deleteAutomation,
    enrollContactManual, getEnrollments, removeEnrollment,
} = require('../controllers/automation.controller');
const { protect } = require('../middleware/auth.middleware');

router.use(protect);

router.get('/', getAutomations);
router.get('/:id', getAutomation);
router.get('/:id/enrollments', getEnrollments);

router.post('/', [
    body('name').trim().notEmpty().withMessage('Automation name is required'),
    body('steps').isArray({ min: 1 }).withMessage('At least one step required'),
    body('entryStepId').notEmpty().withMessage('entryStepId is required'),
], createAutomation);

router.put('/:id', updateAutomation);
router.delete('/:id', deleteAutomation);

router.post('/:id/activate', activateAutomation);
router.post('/:id/pause', pauseAutomation);
router.post('/:id/enroll', [body('contactId').notEmpty()], enrollContactManual);
router.delete('/:id/enrollments/:enrollmentId', removeEnrollment);

module.exports = router;