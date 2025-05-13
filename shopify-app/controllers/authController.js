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

// Start the initial auth flow
exports.startAuth = (req, res) => {
  const { shop } = req.query;
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }

  const redirectUri = `${process.env.APP_URL}/auth/callback`;
  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${apiKey}&scope=${scopes}&redirect_uri=${redirectUri}`;

  res.redirect(installUrl);
};

// Re-authentication flow - used when new scopes are needed
exports.startReauth = async (req, res) => {
  const { shop } = req.query;
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }

  // Check if the shop has an existing session
  const session = await Session.findOne({ shop });
  if (session) {
    console.log(`Re-authenticating shop ${shop} to get updated scopes`);
    
    // Delete the old session to force a new one to be created
    await Session.deleteOne({ shop });
  }

  // Start the normal auth flow
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