require('dotenv').config();

const app = require('../src/app');
const connectDB = require('../src/config/db');

let dbReadyPromise;

function ensureDbConnection() {
  if (!dbReadyPromise) {
    dbReadyPromise = connectDB().catch((error) => {
      dbReadyPromise = undefined;
      throw error;
    });
  }

  return dbReadyPromise;
}

module.exports = async function handler(req, res) {
  await ensureDbConnection();
  return app(req, res);
};
