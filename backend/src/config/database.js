const mongoose = require("mongoose");

async function connectDatabase() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGO_URI is required.");
  await mongoose.connect(uri);
}

module.exports = connectDatabase;
