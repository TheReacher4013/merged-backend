const User = require('../models/User.model');
const Plan = require('../models/Plan.model');
const Subscription = require('../models/Subscription.model');
const Payment = require('../models/Payment.model');
const Campaign = require('../models/Campaign.model');
const Contact = require('../models/Contact.model');
const { asyncHandler } = require('../middleware/errorHandler');


// DASHBOARD STATS


// @desc  Global platform stats
// @route GET /api/admin/stats
// @access Super Admin only
const getStats = asyncHandler(async (req, res) => {
    const [
        totalUsers,
        activeUsers,
        totalCampaigns,
        totalContacts,
        totalRevenue,
        newUsersToday,
        activeSubscriptions,
    ] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ isActive: true }),
        Campaign.countDocuments(),
        Contact.countDocuments(),
        Payment.aggregate([
            { $match: { status: 'captured' } },
            { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
        User.countDocuments({
            createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        }),
        Subscription.countDocuments({ status: 'active' }),
    ]);

    // Monthly revenue (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthlyRevenue = await Payment.aggregate([
        { $match: { status: 'captured', createdAt: { $gte: sixMonthsAgo } } },
        {
            $group: {
                _id: {
                    year: { $year: '$createdAt' },
                    month: { $month: '$createdAt' },
                },
                revenue: { $sum: '$amount' },
                count: { $sum: 1 },
            },
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    // User growth (last 6 months)
    const userGrowth = await User.aggregate([
        { $match: { createdAt: { $gte: sixMonthsAgo } } },
        {
            $group: {
                _id: {
                    year: { $year: '$createdAt' },
                    month: { $month: '$createdAt' },
                },
                count: { $sum: 1 },
            },
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    res.json({
        success: true,
        data: {
            overview: {
                totalUsers,
                activeUsers,
                totalCampaigns,
                totalContacts,
                totalRevenue: totalRevenue[0]?.total || 0,
                newUsersToday,
                activeSubscriptions,
            },
            monthlyRevenue,
            userGrowth,
        },
    });
});


// USER MANAGEMENT


// @desc  Get all users with pagination + filters
// @route GET /api/admin/users
const getAllUsers = asyncHandler(async (req, res) => {
    const {
        page = 1,
        limit = 20,
        search,
        role,
        isActive,
        sortBy = 'createdAt',
        sortOrder = 'desc',
    } = req.query;

    const query = {};
    if (search) {
        query.$or = [
            { name: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
        ];
    }
    if (role) query.role = role;
    if (isActive !== undefined) query.isActive = isActive === 'true';

    const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    const total = await User.countDocuments(query);
    const users = await User.find(query)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .select('-password -refreshTokens -twoFactorSecret -emailVerificationToken -passwordResetToken');

    res.json({
        success: true,
        data: users,
        pagination: {
            total,
            page: Number(page),
            pages: Math.ceil(total / limit),
            limit: Number(limit),
        },
    });
});

// @desc  Get single user details
// @route GET /api/admin/users/:id
const getUserById = asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id)
        .select('-password -refreshTokens -twoFactorSecret -emailVerificationToken -passwordResetToken');

    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Get user's subscription
    const subscription = await Subscription.findOne({ userId: user._id })
        .populate('planId', 'name slug monthlyPrice yearlyPrice')
        .sort({ createdAt: -1 });

    // Get user's stats
    const [campaignCount, contactCount, totalPayments] = await Promise.all([
        Campaign.countDocuments({ userId: user._id }),
        Contact.countDocuments({ userId: user._id }),
        Payment.aggregate([
            { $match: { userId: user._id, status: 'captured' } },
            { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
    ]);

    res.json({
        success: true,
        data: {
            user,
            subscription,
            stats: {
                campaignCount,
                contactCount,
                totalPayments: totalPayments[0]?.total || 0,
            },
        },
    });
});

// @desc  Update user role
// @route PUT /api/admin/users/:id/role
const updateUserRole = asyncHandler(async (req, res) => {
    const { role } = req.body;
    const validRoles = ['super_admin', 'business_admin', 'marketing_manager', 'viewer', 'individual'];

    if (!validRoles.includes(role)) {
        return res.status(400).json({ success: false, message: 'Invalid role' });
    }

    // Prevent self-role change
    if (req.params.id === req.user._id.toString()) {
        return res.status(400).json({ success: false, message: 'Cannot change your own role' });
    }

    const user = await User.findByIdAndUpdate(
        req.params.id,
        { role },
        { new: true }
    ).select('-password -refreshTokens');

    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, message: 'Role updated successfully', data: user });
});

// @desc  Activate / Deactivate user
// @route PUT /api/admin/users/:id/status
const updateUserStatus = asyncHandler(async (req, res) => {
    const { isActive } = req.body;

    if (req.params.id === req.user._id.toString()) {
        return res.status(400).json({ success: false, message: 'Cannot deactivate your own account' });
    }

    const user = await User.findByIdAndUpdate(
        req.params.id,
        { isActive },
        { new: true }
    ).select('-password -refreshTokens');

    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
        success: true,
        message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
        data: user,
    });
});

// @desc  Delete user (hard delete)
// @route DELETE /api/admin/users/:id
const deleteUser = asyncHandler(async (req, res) => {
    if (req.params.id === req.user._id.toString()) {
        return res.status(400).json({ success: false, message: 'Cannot delete your own account' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }

    await User.findByIdAndDelete(req.params.id);

    res.json({ success: true, message: 'User deleted successfully' });
});
// PLAN MANAGEMENT

// @desc  Get all plans
// @route GET /api/admin/plans
const getPlans = asyncHandler(async (req, res) => {
    const plans = await Plan.find().sort({ monthlyPrice: 1 });

    // Add subscriber count to each plan
    const plansWithStats = await Promise.all(
        plans.map(async (plan) => {
            const subscriberCount = await Subscription.countDocuments({
                planId: plan._id,
                status: { $in: ['active', 'trialing'] },
            });
            return { ...plan.toObject(), subscriberCount };
        })
    );

    res.json({ success: true, data: plansWithStats });
});

// @desc  Create plan
// @route POST /api/admin/plans
const createPlan = asyncHandler(async (req, res) => {
    const {
        name, slug, description,
        monthlyPrice, yearlyPrice,
        razorpayMonthlyPlanId, razorpayYearlyPlanId,
        limits, features, isActive, isFree, trialDays,
    } = req.body;

    const existing = await Plan.findOne({ slug });
    if (existing) {
        return res.status(409).json({ success: false, message: 'Plan with this slug already exists' });
    }

    const plan = await Plan.create({
        name, slug, description,
        monthlyPrice, yearlyPrice,
        razorpayMonthlyPlanId, razorpayYearlyPlanId,
        limits, features, isActive, isFree, trialDays,
    });

    res.status(201).json({ success: true, message: 'Plan created successfully', data: plan });
});

// @desc  Update plan
// @route PUT /api/admin/plans/:id
const updatePlan = asyncHandler(async (req, res) => {
    const plan = await Plan.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });

    if (!plan) {
        return res.status(404).json({ success: false, message: 'Plan not found' });
    }

    res.json({ success: true, message: 'Plan updated successfully', data: plan });
});

// @desc  Delete plan
// @route DELETE /api/admin/plans/:id
const deletePlan = asyncHandler(async (req, res) => {
    // Check if any active subscriptions use this plan
    const activeCount = await Subscription.countDocuments({
        planId: req.params.id,
        status: { $in: ['active', 'trialing'] },
    });

    if (activeCount > 0) {
        return res.status(400).json({
            success: false,
            message: `Cannot delete plan — ${activeCount} active subscription(s) are using it`,
        });
    }

    const plan = await Plan.findByIdAndDelete(req.params.id);
    if (!plan) {
        return res.status(404).json({ success: false, message: 'Plan not found' });
    }

    res.json({ success: true, message: 'Plan deleted successfully' });
});

// SUBSCRIPTION MANAGEMENT


// @desc  Get all subscriptions
// @route GET /api/admin/subscriptions
const getAllSubscriptions = asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, status } = req.query;
    const query = {};
    if (status) query.status = status;

    const total = await Subscription.countDocuments(query);
    const subscriptions = await Subscription.find(query)
        .populate('userId', 'name email')
        .populate('planId', 'name slug monthlyPrice yearlyPrice')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit));

    res.json({
        success: true,
        data: subscriptions,
        pagination: { total, page: Number(page), pages: Math.ceil(total / limit) },
    });
});

// PAYMENT HISTORY

// @desc  Get all payments
// @route GET /api/admin/payments
const getAllPayments = asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, status } = req.query;
    const query = {};
    if (status) query.status = status;

    const total = await Payment.countDocuments(query);
    const payments = await Payment.find(query)
        .populate('userId', 'name email')
        .populate('planId', 'name slug')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit));

    res.json({
        success: true,
        data: payments,
        pagination: { total, page: Number(page), pages: Math.ceil(total / limit) },
    });
});

module.exports = {
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
};
