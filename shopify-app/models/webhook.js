const mongoose = require('mongoose');

const WebhookSchema = new mongoose.Schema({
  shop: {
    type: String,
    required: true,
    index: true
  },
  topic: {
    type: String,
    required: true
  },
  webhookId: {
    type: String,
    required: true
  },
  address: {
    type: String,
    required: true
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Compound index for shop + topic to ensure uniqueness
WebhookSchema.index({ shop: 1, topic: 1 }, { unique: true });

module.exports = mongoose.model('Webhook', WebhookSchema);