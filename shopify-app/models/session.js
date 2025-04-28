const mongoose = require('mongoose');

const SessionSchema = new mongoose.Schema({
  shop: String,
  accessToken: String,
  scope: String,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Session', SessionSchema);
