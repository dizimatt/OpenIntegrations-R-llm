const mongoose = require('mongoose');

const connectMongo = async () => {
  await mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log('MongoDB connected');
};

module.exports = connectMongo;
