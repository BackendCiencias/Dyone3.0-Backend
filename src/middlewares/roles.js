// Middleware de control de roles
// Usa req.user.roles (inyectado por authMiddleware)
export function requireRoles(roles) {
  return (req, res, next) => {
    const user = req.user;
    if (!user || !user.roles) {
      return res.status(401).json({ message: 'No autorizado' });
    }
    const hasRole = user.roles.some((r) => roles.includes(r));
    if (!hasRole) {
      return res.status(403).json({ message: 'Permisos insuficientes' });
    }
    next();
  };
}