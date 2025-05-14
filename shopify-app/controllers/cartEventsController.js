// controllers/cartEventsController.js with updated methods
const CartEvent = require('../models/cartEvent');

// Get cart events for a shop
exports.getCartEvents = async (req, res) => {
  try {
    const { shop, event } = req.query;
    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }

    // Pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Build query
    const query = { shop };
    
    // Filter by event type if provided
    if (event) {
      query.event = event;
    }

    // Query cart events
    const events = await CartEvent.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Get total count for pagination
    const total = await CartEvent.countDocuments(query);

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

// Get cart adjustments summary
exports.getCartAdjustmentsSummary = async (req, res) => {
  try {
    const { shop } = req.query;
    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }

    // Get summary of cart adjustments for the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const adjustments = await CartEvent.find({
      shop,
      event: 'system_adjusted',
      createdAt: { $gte: thirtyDaysAgo }
    });

    // Calculate statistics
    const stats = {
      totalAdjustments: adjustments.length,
      totalItemsRemoved: 0,
      mostCommonlyAdjustedItems: {},
      averageReductionPerCart: 0
    };

    if (adjustments.length > 0) {
      let totalRemoved = 0;
      
      adjustments.forEach(adjustment => {
        if (adjustment.mutationInfo) {
          const itemsRemoved = adjustment.mutationInfo.itemsBefore - adjustment.mutationInfo.itemsAfter;
          totalRemoved += itemsRemoved;
          
          // Track most commonly adjusted items
          if (adjustment.mutationInfo.adjustmentDetails) {
            adjustment.mutationInfo.adjustmentDetails.forEach(detail => {
              if (!stats.mostCommonlyAdjustedItems[detail.title]) {
                stats.mostCommonlyAdjustedItems[detail.title] = {
                  count: 0,
                  totalReduction: 0
                };
              }
              
              stats.mostCommonlyAdjustedItems[detail.title].count++;
              stats.mostCommonlyAdjustedItems[detail.title].totalReduction += detail.reduction;
            });
          }
        }
      });
      
      stats.totalItemsRemoved = totalRemoved;
      stats.averageReductionPerCart = totalRemoved / adjustments.length;
      
      // Convert most commonly adjusted items to array for sorting
      const itemsArray = Object.entries(stats.mostCommonlyAdjustedItems).map(([title, data]) => ({
        title,
        count: data.count,
        totalReduction: data.totalReduction
      }));
      
      // Sort by count descending
      itemsArray.sort((a, b) => b.count - a.count);
      
      // Return top 5
      stats.mostCommonlyAdjustedItems = itemsArray.slice(0, 5);
    }

    res.json({ 
      stats,
      recentAdjustments: adjustments.slice(0, 5) 
    });
  } catch (error) {
    console.error('Error getting cart adjustments summary:', error);
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: error.message 
    });
  }
};