module.exports = {
  upgrade: async (conn) => {
    // Migration code goes in here
  },
  downgrade: async (conn) => {
    // De-migration code goes in here
  },
  transactUpgrade: true,
  transactDowngrade: true
};
