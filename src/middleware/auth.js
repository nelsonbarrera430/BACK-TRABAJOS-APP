const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  try {
    const header = req.headers['authorization'] || req.headers['Authorization'];

    console.log('HEADER RECIBIDO:', header); // para debuggear

    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No autorizado — token requerido' });
    }

    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    console.log('TOKEN DECODIFICADO:', decoded); // para debuggear

    req.user = decoded;
    next();
  } catch (err) {
    console.error('ERROR AUTH:', err.message);
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
};