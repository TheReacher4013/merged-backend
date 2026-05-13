const isAdmin = (req, res, next) => {
  const role = req.user?.role;
  if (role !== 'super_admin' && role !== 'business_admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  next();
};

module.exports = isAdmin;
