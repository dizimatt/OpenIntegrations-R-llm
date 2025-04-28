module.exports = (req, res, next) => {
  const { shop } = req.query;
  if (!shop) return res.status(401).send('Missing shop parameter');
  next();
};
