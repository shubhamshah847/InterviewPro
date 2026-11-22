const { createClient } = require("redis");

const client = process.env.REDIS_URI
  ? createClient({ url: process.env.REDIS_URI })
  : null;

if (client) {
  client.on("error", () => console.error("Redis connection error."));
}

async function connectRedis() {
  if (client && !client.isOpen) await client.connect();
}

module.exports = { client, connectRedis };
