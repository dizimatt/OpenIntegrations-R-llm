const CartEvent = require('../models/cartEvent');

// Get cart events for a shop
exports.getCartEvents = async (req, res) => {
  try {
    const { shop } = req.query;
    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }

    // Pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Query cart events
    const events = await CartEvent.find({ shop })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Get total count for pagination
    const total = await CartEvent.countDocuments({ shop });

    res.json({
      events,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error getting cart events:', error);
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: error.message 
    });
  }
};

// Get details of a specific cart event
exports.getCartEventDetails = async (req, res) => {
  try {
    const { shop } = req.query;
    const { eventId } = req.params;
    
    if (!shop || !eventId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Include raw data in this query
    const event = await CartEvent.findOne({ 
      _id: eventId, 
      shop 
    }).select('+rawData');

    if (!event) {
      return res.status(404).json({ error: 'Cart event not found' });
    }

    res.json({ event });
  } catch (error) {
    console.error('Error getting cart event details:', error);
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: error.message 
    });
  }
};