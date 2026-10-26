exports.requireLogin = (req, res, next) => (req.session.user ? next() : res.redirect('/login'));
exports.requireRole = (...roles) => (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  if (!roles.includes(req.session.user.role)) {
    return res.status(403).render('error', { title: 'Accès refusé', message: "Vous n'avez pas le droit d'accéder à cette page." });
  }
  next();
};
