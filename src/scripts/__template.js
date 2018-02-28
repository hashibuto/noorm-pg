module.exports = {
  upgrade: (conn) => {
    // Migration code goes in here
  },
  downgrade: (conn) => {
    // De-migration code goes in here
  },
  transactUpgrade: true,
  transactDowngrade: true
};
