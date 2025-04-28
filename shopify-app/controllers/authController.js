const axios = require('axios');
const crypto = require('crypto');
const Session = require('../models/session');
const { apiKey, apiSecret, scopes } = require('../config/shopify');

const buildHmac = (query) => {
  const { hmac, signature, ...rest } = query;

  const sortedParams = Object.keys(rest)
    .sort()
    .map(key => {
      return `${key}=${Array.isArray(rest[key]) ? rest[key].join(',') : rest[key]}`;
    })
    .join('&');

  return crypto
    .createHmac('sha256', apiSecret)
    .update(sortedParams)
    .digest('hex');
};

// New function to start auth
exports.startAuth = (req, res) => {
  const { shop } = req.query;
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }

  const redirectUri = `${process.env.APP_URL}/auth/callback`;
  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${apiKey}&scope=${scopes}&redirect_uri=${redirectUri}`;

  res.redirect(installUrl);
};

exports.install = async (req, res) => {
  const { shop, hmac, code } = req.query;
  if (!shop || !hmac || !code) {
    return res.status(400).send('Required parameters missing');
  }

  const generatedHash = buildHmac(req.query);
  if (generatedHash !== hmac) {
    return res.status(400).send('HMAC validation failed');
  }

  const tokenUrl = `https://${shop}/admin/oauth/access_token`;
  try {
    const response = await axios.post(tokenUrl, {
      client_id: apiKey,
      client_secret: apiSecret,
      code,
    });

    const { access_token, scope } = response.data;

    await Session.findOneAndUpdate(
      { shop },
      { accessToken: access_token, scope },
      { upsert: true }
    );

    res.redirect(`/embedded?shop=${shop}`);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error exchanging token');
  }
};
