const mongoose = require('mongoose');

const externalPlayerSchema = new mongoose.Schema(
  {
    platform: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    externalUserId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    email: {
      type: String,
      default: '',
      trim: true,
      lowercase: true,
    },
    coins: {
      type: Number,
      default: 0,
      min: 0,
    },
    returnUrl: {
      type: String,
      default: '',
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

externalPlayerSchema.index({ platform: 1, externalUserId: 1 }, { unique: true });

module.exports = mongoose.model('ExternalPlayer', externalPlayerSchema);
