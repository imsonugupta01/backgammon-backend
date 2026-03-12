const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema(
  {
    mode: {
      type: String,
      enum: ['vsComputer', 'yourself', 'online'],
      required: true,
    },
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    participantSnapshots: [
      {
        participantType: {
          type: String,
          enum: ['native', 'external'],
          required: true,
        },
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          default: null,
        },
        externalPlayerId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'ExternalPlayer',
          default: null,
        },
        externalUserId: {
          type: String,
          default: null,
        },
        platform: {
          type: String,
          default: null,
        },
        name: {
          type: String,
          required: true,
        },
        email: {
          type: String,
          default: '',
        },
        coinsAtStart: {
          type: Number,
          default: 0,
        },
      },
    ],
    winnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    loserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    winnerExternalPlayerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ExternalPlayer',
      default: null,
    },
    loserExternalPlayerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ExternalPlayer',
      default: null,
    },
    reason: {
      type: String,
      default: 'completed',
    },
    stake: {
      type: Number,
      default: 0,
      min: 0,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Match', matchSchema);
