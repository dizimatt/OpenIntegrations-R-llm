const mongoose = require('mongoose');

const CartEventSchema = new mongoose.Schema({
  shop: {
    type: String,
    required: true,
    index: true
  },
  cartToken: {
    type: String,
    required: true,
    index: true
  },
  cartId: {
    type: String,
    required: true
  },
  event: {
    type: String,
    enum: ['created', 'updated', 'completed'],
    default: 'updated'
  },
  lineItems: [{
    variantId: String,
    productId: String,
    title: String,
    quantity: Number,
    price: Number
  }],
  customerInfo: {
    email: String,
    firstName: String,
    lastName: String,
    customerId: String
  },
  totalPrice: Number,
  subtotalPrice: Number,
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  rawData: {
    type: mongoose.Schema.Types.Mixed,
    select: false // Don't include by default in queries
  }
});

module.exports = mongoose.model('CartEvent', CartEventSchema);